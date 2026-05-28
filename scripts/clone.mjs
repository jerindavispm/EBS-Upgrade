#!/usr/bin/env node
// ============================================================
// CLONE SCRIPT — Source Supabase → Target Supabase
// ------------------------------------------------------------
// Reads ALL rows from each table in the source project using
// the source service_role key, then UPSERTs them into the
// target project using the target service_role key.
// Also clones the team-photos storage bucket.
//
// Source key: READ-ONLY usage (only .select() and storage downloads)
// Target key: write usage (upsert + storage upload)
//
// Usage:
//   Set env vars and run: node scripts/clone.mjs
//   Required: SOURCE_URL, SOURCE_KEY, TARGET_URL, TARGET_KEY
// ============================================================

import { createClient } from '@supabase/supabase-js'

const { SOURCE_URL, SOURCE_KEY, TARGET_URL, TARGET_KEY } = process.env

if (!SOURCE_URL || !SOURCE_KEY || !TARGET_URL || !TARGET_KEY) {
  console.error('Missing required env vars: SOURCE_URL, SOURCE_KEY, TARGET_URL, TARGET_KEY')
  process.exit(1)
}

// Tables in dependency order (parents before children).
// `profiles` is special — handled separately (needs auth.users bootstrap first).
const DATA_TABLES = [
  // Independent / parent tables
  'projects',
  'landing_page_content',
  'app_settings',
  'support_subcategories',
  'testing_subcategories',
  'project_subcategories',
  'employee_leaves',
  'war_day_ranges',
  'categories',
  'subcategories',
  'badges',
  // Children of projects
  'milestones',
  'risks',
  'delay_reasons',
  // Children of profiles
  'task_logs',
  'priority_tasks',
  'user_badges',
]

const STORAGE_BUCKETS = [
  { name: 'team-photos', public: true },
]

const source = createClient(SOURCE_URL, SOURCE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const target = createClient(TARGET_URL, TARGET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function logStep(msg) {
  console.log(`\n▶ ${msg}`)
}
function logResult(msg) {
  console.log(`  ✓ ${msg}`)
}
function logSkip(msg) {
  console.log(`  ⊘ ${msg}`)
}
function logWarn(msg) {
  console.log(`  ⚠ ${msg}`)
}

async function fetchAll(client, table, pageSize = 1000) {
  const rows = []
  let from = 0
  while (true) {
    const { data, error } = await client
      .from(table)
      .select('*')
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`fetchAll(${table}): ${error.message}`)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return rows
}

async function tableExists(client, table) {
  // A SELECT with limit 0 returns no rows but errors if table doesn't exist.
  const { error } = await client.from(table).select('*', { count: 'exact', head: true })
  if (error && /not exist|not found/i.test(error.message)) return false
  if (error) {
    // Other errors (permission, etc.) — surface
    throw new Error(`tableExists(${table}): ${error.message}`)
  }
  return true
}

async function copyProfilesWithAuthUsers() {
  logStep('Copying profiles (with auth.users placeholders)')
  const profiles = await fetchAll(source, 'profiles')
  logResult(`fetched ${profiles.length} profile rows from source`)

  let authCreated = 0
  let authSkipped = 0
  for (const p of profiles) {
    const placeholderEmail = p.email && p.email.includes('@')
      ? `clone-${p.id.slice(0, 8)}-${p.email}`
      : `clone-${p.id}@ebs-upgrade.local`
    const { error } = await target.rpc('clone_auth_user', { p_id: p.id, p_email: placeholderEmail })
    if (error) {
      logWarn(`auth.users insert for ${p.id} failed: ${error.message}`)
      authSkipped += 1
    } else {
      authCreated += 1
    }
  }
  logResult(`auth.users: ${authCreated} created (or already existed), ${authSkipped} failed`)

  // Now upsert profile data. Trigger on_auth_user_created already created
  // basic rows for each auth.user, so upsert merges the full data on top.
  const { error: upsertErr } = await target.from('profiles').upsert(profiles, { onConflict: 'id' })
  if (upsertErr) {
    logWarn(`profiles upsert failed: ${upsertErr.message}`)
  } else {
    logResult(`upserted ${profiles.length} profile rows into target`)
  }
}

async function copyTable(table) {
  logStep(`Copying table: ${table}`)
  const exists = await tableExists(source, table)
  if (!exists) {
    logSkip(`source has no '${table}' table — skipping`)
    return
  }
  const targetExists = await tableExists(target, table)
  if (!targetExists) {
    logSkip(`target has no '${table}' table — skipping (run setup_target.sql first?)`)
    return
  }
  const rows = await fetchAll(source, table)
  logResult(`fetched ${rows.length} rows from source`)
  if (rows.length === 0) {
    logResult('nothing to copy')
    return
  }
  // Use upsert so re-running is safe. Most tables have an 'id' PK.
  const { error } = await target.from(table).upsert(rows, { onConflict: 'id' })
  if (error) {
    // Fallback to insert if onConflict column doesn't match
    const { error: insertErr } = await target.from(table).insert(rows)
    if (insertErr) {
      logWarn(`failed to copy ${table}: ${error.message} / insert fallback: ${insertErr.message}`)
      return
    }
  }
  logResult(`copied ${rows.length} rows into target`)
}

async function ensureBucket(bucket) {
  const { data, error } = await target.storage.getBucket(bucket.name)
  if (data) return
  if (error && !/not found/i.test(error.message)) {
    logWarn(`getBucket(${bucket.name}): ${error.message}`)
  }
  const { error: createErr } = await target.storage.createBucket(bucket.name, { public: bucket.public })
  if (createErr) {
    logWarn(`createBucket(${bucket.name}): ${createErr.message}`)
  } else {
    logResult(`created bucket '${bucket.name}' (public=${bucket.public})`)
  }
}

async function listAllFiles(client, bucket, prefix = '') {
  const results = []
  const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error) {
    logWarn(`list ${bucket}/${prefix}: ${error.message}`)
    return results
  }
  for (const entry of data || []) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.id === null) {
      // It's a folder — recurse
      const nested = await listAllFiles(client, bucket, path)
      results.push(...nested)
    } else {
      results.push(path)
    }
  }
  return results
}

async function copyBucket(bucket) {
  logStep(`Copying storage bucket: ${bucket.name}`)
  await ensureBucket(bucket)
  const files = await listAllFiles(source, bucket.name)
  logResult(`source has ${files.length} files`)

  let copied = 0
  let failed = 0
  for (const path of files) {
    const { data: blob, error: dlErr } = await source.storage.from(bucket.name).download(path)
    if (dlErr) {
      logWarn(`download ${path}: ${dlErr.message}`)
      failed += 1
      continue
    }
    const arrayBuffer = await blob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const { error: ulErr } = await target.storage.from(bucket.name).upload(path, buffer, {
      upsert: true,
      contentType: blob.type || 'application/octet-stream',
    })
    if (ulErr) {
      logWarn(`upload ${path}: ${ulErr.message}`)
      failed += 1
    } else {
      copied += 1
    }
  }
  logResult(`copied ${copied} files (${failed} failed)`)
}

async function rewriteAvatarUrls() {
  logStep('Rewriting avatar_url from source bucket URL → target bucket URL')
  const sourceHost = new URL(SOURCE_URL).host
  const targetHost = new URL(TARGET_URL).host
  const { data, error } = await target
    .from('profiles')
    .select('id, avatar_url')
    .like('avatar_url', `%${sourceHost}%`)
  if (error) {
    logWarn(`select avatar_urls: ${error.message}`)
    return
  }
  let updated = 0
  for (const row of data || []) {
    const newUrl = row.avatar_url.replace(sourceHost, targetHost)
    const { error: updErr } = await target.from('profiles').update({ avatar_url: newUrl }).eq('id', row.id)
    if (updErr) {
      logWarn(`update profile ${row.id}: ${updErr.message}`)
    } else {
      updated += 1
    }
  }
  logResult(`rewrote ${updated} avatar_url values`)
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  Supabase Clone: source → target                        ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log(`Source: ${SOURCE_URL}`)
  console.log(`Target: ${TARGET_URL}`)

  // Step 1: profiles + their auth.users placeholders (must be first)
  await copyProfilesWithAuthUsers()

  // Step 2: data tables in dependency order
  for (const table of DATA_TABLES) {
    await copyTable(table)
  }

  // Step 3: storage buckets
  for (const bucket of STORAGE_BUCKETS) {
    await copyBucket(bucket)
  }

  // Step 4: rewrite avatar URLs to point at target bucket
  await rewriteAvatarUrls()

  console.log('\n══════════════════════════════════════════════════════════')
  console.log('  ✓ Clone complete')
  console.log('══════════════════════════════════════════════════════════')
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
