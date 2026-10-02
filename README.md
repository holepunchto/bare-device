# bare-device

Find devices and run things on them. A device is this machine, an iOS simulator, or an Android device or emulator, and each one says which host to build for with <https://github.com/holepunchto/bare-build>. A standalone executable can be run on any of them, and an app can be installed and launched on any of them.

```
npm i bare-device
```

## Usage

```js
const { find } = require('bare-device')

const device = await find({ platform: 'ios', name: 'iPhone 17' })

// Build the app for `device.host`, then:

await device.install('out/App.app')

const app = await device.launch('out/App.app')

app.stdout.on('data', (data) => console.log(data.toString()))

await app.close()
```

A standalone executable is run with `spawn()`:

```js
const device = await find({ platform: 'android' })

// Build a standalone executable for `device.host`, then:

const process = await device.spawn('out/bare', [], { stdio: 'inherit' })

const { code } = await process.exited

await process.close()
```

On Android, Bare writes `console` output to logcat rather than to standard output.

## License

Apache-2.0
