const { PassThrough } = require('bare-stream')

exports.normalize = function normalize(stdio = ['ignore', 'pipe', 'pipe']) {
  if (typeof stdio === 'string') return [stdio, stdio, stdio]

  return [stdio[0] || 'ignore', stdio[1] || 'pipe', stdio[2] || 'pipe']
}

exports.sink = function sink(io, log) {
  const stream = io === 'pipe' ? new PassThrough() : null

  return {
    stream,

    write(line) {
      if (stream !== null) stream.write(line + '\n')
      else if (io === 'inherit') log(line)
    },

    end() {
      if (stream !== null) stream.end()
    }
  }
}
