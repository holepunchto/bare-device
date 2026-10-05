module.exports = class DeviceProcess {
  constructor(child, opts = {}) {
    const {
      stdout = child.stdout,
      stderr = child.stderr,
      exited = DeviceProcess.exited(child),
      stop = () => DeviceProcess.kill(child)
    } = opts

    this._stop = stop

    this.stdout = stdout
    this.stderr = stderr
    this.exited = exited
  }

  static exited(child) {
    return new Promise((resolve, reject) => {
      child.on('error', reject).on('exit', (code, signal) => resolve({ code, signal }))
    })
  }

  static kill(child) {
    if (child.exitCode === null && child.signalCode === null) child.kill()
  }

  async close() {
    await this._stop()

    await this.exited.catch(() => {})
  }
}
