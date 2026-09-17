// Expo's default config already watches the monorepo root and resolves
// workspace packages through their package.json "exports".
const { getDefaultConfig } = require('expo/metro-config')

module.exports = getDefaultConfig(__dirname)
