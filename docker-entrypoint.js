#!/usr/bin/env node

import { spawn } from 'node:child_process'

const env = { ...process.env }

console.log('[entrypoint] Starting docker entrypoint...')
console.log('[entrypoint] Command:', process.argv.slice(2).join(' '))

// If running the web server then migrate existing database
if (process.argv.slice(-3).join(' ') === 'npm run start') {
  console.log('[entrypoint] Running Prisma migrations...')
  try {
    await exec('npx prisma migrate deploy')
    console.log('[entrypoint] Prisma migrations completed successfully')
  } catch (error) {
    console.error('[entrypoint] Prisma migration failed:', error)
    process.exit(1)
  }

  if (process.env.ADMIN_PASSWORD) {
    console.log('[entrypoint] ADMIN_PASSWORD set — running preset admin seed script...')
    try {
      await exec('node dist/server/server/src/scripts/seed-admin.js')
      console.log('[entrypoint] Preset admin seed step completed')
    } catch (error) {
      // Non-fatal: unlike migrations, a seeding failure must never block the
      // app from starting (the admin account may already exist, e.g. on
      // container restart/recreate).
      console.error('[entrypoint] Preset admin seed step failed (non-fatal):', error)
    }
  }
}

// launch application
console.log('[entrypoint] Launching application...')
try {
  await exec(process.argv.slice(2).join(' '))
} catch (error) {
  console.error('[entrypoint] Application failed:', error)
  process.exit(1)
}

function exec(command) {
  console.log('[entrypoint] Executing:', command)
  const child = spawn(command, { shell: true, stdio: 'inherit', env })
  return new Promise((resolve, reject) => {
    child.on('exit', code => {
      if (code === 0) {
        console.log('[entrypoint] Command succeeded:', command)
        resolve()
      } else {
        console.error('[entrypoint] Command failed with code', code, ':', command)
        reject(new Error(`${command} failed rc=${code}`))
      }
    })
  })
}
