const packageJson = require('./package.json')

module.exports = {
  ...packageJson.build,
  appId: 'com.tintin.desktop.dev',
  productName: 'TinTin Dev',
  directories: {
    ...packageJson.build.directories,
    output: 'dist-dev'
  },
  extraMetadata: {
    name: 'tintin-dev',
    productName: 'TinTin Dev',
    dshDesktopChannel: 'development'
  },
  artifactName: 'tintin-dev-${os}-${arch}.${ext}',
  nsis: {
    ...packageJson.build.nsis,
    artifactName: 'tintin-dev-windows-${arch}-setup.${ext}'
  },
  publish: null
}
