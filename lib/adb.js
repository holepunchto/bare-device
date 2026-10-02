const fs = require('fs')
const os = require('os')
const path = require('path')
const env = require('#env')
const exec = require('./exec')

function adb() {
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || path.join(os.homedir(), '.android', 'sdk')

  const file = path.join(sdk, 'platform-tools', os.platform() === 'win32' ? 'adb.exe' : 'adb')

  return fs.existsSync(file) ? file : 'adb'
}

module.exports = exports = adb

exports.exec = function (args) {
  return exec(adb(), args)
}
