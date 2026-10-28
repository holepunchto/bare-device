const test = require('brittle')
const path = require('path')
const { find } = require('.')

test('spawn with env', async (t) => {
  const device = await find()

  const process = await device.spawn(Bare.argv[0], [path.join(__dirname, 'test/fixtures/env.js')], {
    env: { BARE_DEVICE_TEST: 'spawn' }
  })

  let output = ''

  process.stdout.on('data', (data) => {
    output += data
  })

  const { code } = await process.exited

  t.is(code, 0)
  t.is(output.trim(), 'spawn')
})
