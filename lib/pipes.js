const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const DeviceProcess = require('./process')
const exec = require('./exec')
const lines = require('./lines')
const { normalize, sink } = require('./stdio')

// Each pipe is read by `cat`, so that a launch that never opens it cannot block
// a read.
module.exports = async function pipes(stdio, tmp = os.tmpdir()) {
  const [, stdout, stderr] = normalize(stdio)

  const dir = await fs.promises.mkdtemp(path.join(tmp, 'bare-device-'))

  const paths = [path.join(dir, 'stdout'), path.join(dir, 'stderr')]

  await exec('mkfifo', paths)

  const readers = paths.map((pipe) => spawn('cat', [pipe], { stdio: ['ignore', 'pipe', 'ignore'] }))

  const output = sink(stdout, console.log)
  const errors = sink(stderr, console.error)

  const printed = lines(readers[0].stdout, (line) => output.write(line))
  const failed = lines(readers[1].stdout, (line) => errors.write(line))

  const ended = Promise.all([printed, failed]).then(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true })

    output.end()
    errors.end()
  })

  return {
    paths,
    stdout: output.stream,
    stderr: errors.stream,
    ended,
    kill() {
      for (const reader of readers) DeviceProcess.kill(reader)
    }
  }
}
