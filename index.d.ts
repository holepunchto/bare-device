import { Subprocess } from 'bare-subprocess'

type Readable = NonNullable<Subprocess['stdout']>

type IO = 'inherit' | 'pipe' | 'ignore'

/** A running process on a device, seen from this machine. */
interface DeviceProcess {
  /** What the process writes to its standard output, or `null` if it is not piped. */
  readonly stdout: Readable | null
  /** What the process writes to its standard error, or `null` if it is not piped. */
  readonly stderr: Readable | null
  /** Resolves when the process this machine runs for it exits. */
  readonly exited: Promise<{ code: number | null; signal: string | null }>

  /** Stop the process, and resolve once it has stopped and been cleaned up after. */
  close(): Promise<void>
}

interface SpawnOptions {
  /** How the standard streams are connected. Defaults to `['ignore', 'pipe', 'pipe']`. */
  stdio?: IO | [stdin?: IO, stdout?: IO, stderr?: IO]
}

interface Device {
  readonly id: string
  readonly name: string
  /** The platform of the device, such as `darwin`, `ios` or `android`. */
  readonly platform: string
  readonly kind: 'local' | 'simulator' | 'emulator' | 'device'
  /** What to build for, such as `darwin-arm64`, `ios-arm64-simulator` or `android-arm64`. */
  readonly host: string
  /** Whether the device is up, so that it can be used without being started first. */
  readonly running: boolean

  /** Run a standalone executable built for `host`. */
  spawn(executable: string, args?: string[], opts?: SpawnOptions): Promise<DeviceProcess>

  /**
   * Make `port` on this machine reachable as `port` on the device. Nothing is needed for a device
   * that shares the network of this machine.
   */
  reverse(port: number): Promise<void>
}

/** A device that apps can be installed on and launched. */
interface AppDevice extends Device {
  /** Install the app at `app`, booting the device first if it has to be. */
  install(app: string): Promise<void>

  /**
   * Launch the app at `app`, passing it `args`. With `activate`, an app on this machine is brought
   * to the front.
   */
  launch(
    app: string,
    opts?: { args?: string[]; activate?: boolean } & SpawnOptions
  ): Promise<DeviceProcess>
}

/** This machine. */
interface LocalDevice extends AppDevice {
  readonly kind: 'local'
}

declare class LocalDevice {
  constructor()
}

/** An iOS simulator. */
interface SimulatorDevice extends AppDevice {
  readonly kind: 'simulator'
  readonly booted: boolean

  boot(): Promise<void>
}

declare class SimulatorDevice {
  protected constructor()

  static list(): Promise<SimulatorDevice[]>
}

/**
 * An Android device or emulator. Launching an APK requires the optional `bare-apk` dependency, and
 * an app's output is read from its log, so it includes what Android itself logs for the app.
 */
interface AndroidDevice extends AppDevice {
  readonly kind: 'emulator' | 'device'

  /** Run `command` in a shell on the device, and resolve with what it printed. */
  shell(command: string, args?: string[]): Promise<string>
}

declare class AndroidDevice {
  protected constructor()

  static list(): Promise<AndroidDevice[]>
}

/** Every device that can be used from this machine, this machine first. */
declare function devices(): Promise<Device[]>

/**
 * Find a device for `platform`, which defaults to this machine's. A `name` picks a device by name,
 * preferring an exact match. Without one, the first device that is already running is picked.
 */
declare function find(opts?: { platform?: string; name?: string | null }): Promise<Device>

export {
  AndroidDevice,
  AppDevice,
  Device,
  DeviceProcess,
  LocalDevice,
  SimulatorDevice,
  SpawnOptions,
  devices,
  find
}
