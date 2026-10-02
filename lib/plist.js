const exec = require('./exec')

exports.read = function read(file, key) {
  return exec('plutil', ['-extract', key, 'raw', '-o', '-', file]).then((value) => value.trim())
}
