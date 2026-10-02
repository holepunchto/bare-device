// Call `online` with each line of `stream`, and resolve once it has ended.
module.exports = function lines(stream, online) {
  return new Promise((resolve) => {
    let buffered = ''

    stream
      .on('data', (data) => {
        const parts = (buffered + data.toString()).split(/\r?\n/)

        buffered = parts.pop()

        for (const line of parts) online(line)
      })
      .on('end', () => {
        if (buffered !== '') online(buffered)

        resolve()
      })
  })
}
