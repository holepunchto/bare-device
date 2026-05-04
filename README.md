# bare-device

Device management for android and ios. Delegates to [bare-device-android](https://github.com/holepunchto/bare-device-android) and [bare-device-ios](https://github.com/holepunchto/bare-device-ios), which you may choose to use directly.

## Install

```
npm install bare-device
```

## Usage

```js
import { AndroidDevice, IOSDevice } from 'bare-device'
import stdio from 'bare-stdio'

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
  const app = 'com.example.myapp'
  const device = new IOSDevice('your-ios-device-id')

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

See [bare-device-android](https://github.com/holepunchto/bare-device-android) and [bare-device-ios](https://github.com/holepunchto/bare-device-ios) for more API details.

## License

Apache-2.0
