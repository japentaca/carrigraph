// Entry point for process managers (pm2, see deploy/ecosystem.config.cjs).
// server/index.js only listens when it is the script Node was started with;
// under pm2 the main script is pm2's own wrapper, so that check never passes.
import { start } from './index.js'

start().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
