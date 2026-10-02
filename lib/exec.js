const { spawn } = require('child_process')

// Run a tool to completion and resolve with what it printed.
module.exports = function exec(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    const stdout = []
    const stderr = []

    child.stdout.on('data', (data) => stdout.push(data))
    child.stderr.on('data', (data) => stderr.push(data))

    child.on('error', reject).on('exit', (code) => {
      if (code === 0) return resolve(Buffer.concat(stdout).toString())

      const message = Buffer.concat(stderr).toString().trim()

      reject(new Error(`${[file, ...args].join(' ')} exited with code ${code}: ${message}`))
    })
  })
}
