const os = require('os')

// An app can exit on its own between being looked up and being stopped, which
// leaves it where stopping it would.
module.exports = function kill(pid) {
  try {
    os.kill(pid)
  } catch (err) {
    if (err.code !== 'ESRCH') throw err
  }
}
