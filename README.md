# bare-device

Cross-platform device management for Android and iOS. Delegates to `bare-device-android` (<https://github.com/holepunchto/bare-device-android>) and `bare-device-ios` (<https://github.com/holepunchto/bare-device-ios>), which may also be used directly.

```
npm i bare-device
```

## Usage

```js
const { AndroidDevice, IOSDevice } = require('bare-device')
const stdio = require('bare-stdio')

{
  const device = new AndroidDevice('your-android-device-id')
  const app = 'com.example.myapp'

  device.install('./build/android-arm64/myapp.apk')
  device.grant(app, ['ACCESS_FINE_LOCATION'])

  const androidProcess = device.launch(app, {
    activity: 'to.holepunch.bare.Activity',
    stream: true
  })

  androidProcess.stdout.pipe(stdio.out)
  await androidProcess.close()
  device.stop(app)
}

{
  const device = new IOSDevice('your-ios-device-id')
  const app = 'com.example.myapp'

  device.install('./build/ios-arm64/myapp.app')

  const iosProcess = device.launch(app, {
    args: ['driver'],
    stream: true
  })

  iosProcess.stdout.pipe(stdio.out)
  await iosProcess.close()
  device.stop(app)
}
```

## API

#### `const { AndroidDevice, IOSDevice } = require('bare-device')`

Re-exports `AndroidDevice` from `bare-device-android` and `IOSDevice` from `bare-device-ios`.

#### `const AndroidDevice = require('bare-device/android')`

Subpath export equivalent to `require('bare-device-android')`. See <https://github.com/holepunchto/bare-device-android> for the full API.

#### `const IOSDevice = require('bare-device/ios')`

Subpath export equivalent to `require('bare-device-ios')`. See <https://github.com/holepunchto/bare-device-ios> for the full API.

## License

Apache-2.0
