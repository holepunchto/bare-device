const os = require('os')

module.exports = function kill(pid) {
  os.kill(pid)
}
