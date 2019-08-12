const unorm = require('unorm');
const { Buffer } = require('safe-buffer');
const _pbkdf2 = require('pbkdf2');
const shamir = require('secrets.js-grempe');

const pbkdf2 = _pbkdf2.pbkdf2Sync;

exports.fromHexString = hexString => new Uint8Array(hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
exports.toHexString = bytes => bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');

exports.buildPrivateKeyShamir = (clientKeyShare, serverKeyShare) => {
  return shamir.combine([clientKeyShare, serverKeyShare]);
};

exports.buildPrivateKeyShamirHex = (clientKeyShare, serverKeyShare) => {
  return exports.fromHexString(shamir.combine([clientKeyShare, serverKeyShare]));
};

exports.mnemonicToSeed = (mnemonic, password) => {
  function salt(pw) {
    return `mnemonic${ (pw || '') }`;
  }

  const mnemonicBuffer = Buffer.from(unorm.nfkd(mnemonic), 'utf8');
  const saltBuffer = Buffer.from(salt(unorm.nfkd(password)), 'utf8');

  return pbkdf2(mnemonicBuffer, saltBuffer, 2048, 32, 'sha512');
};
