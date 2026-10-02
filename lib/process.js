// A running process on a device, seen from this machine. What it prints
// arrives on `stdout` and `stderr`, and `close()` stops it.
module.exports = class DeviceProcess {
  constructor(child, opts = {}) {
    const {
      stdout = child.stdout,
      stderr = child.stderr,
      exited = DeviceProcess.exited(child),
      stop = null,
      onclose = null
    } = opts

    this._child = child
    this._stop = stop
    this._onclose = onclose

    this.stdout = stdout
    this.stderr = stderr
    this.exited = exited
  }

  static exited(child) {
    return new Promise((resolve, reject) => {
      child.on('error', reject).on('exit', (code, signal) => resolve({ code, signal }))
    })
  }

  async close() {
    if (this._stop !== null) {
      await this._stop()
    } else if (this._child.exitCode === null && this._child.signalCode === null) {
      this._child.kill()
    }

    await this.exited.catch(() => {})

    if (this._onclose !== null) await this._onclose()
  }
}
