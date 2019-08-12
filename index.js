const { LocalAddress, CryptoUtils } = require('loom-js');

const bip39 = require('bip39');
const hdkey = require('ethereumjs-wallet/hdkey');
const shamir = require('secrets.js-grempe');
const plasma = require('./plasmaContracts');

const {
  toHexString, fromHexString, mnemonicToSeed, buildPrivateKeyShamir, buildPrivateKeyShamirHex
} = require('./utils');
const {
  mapAccounts, getMainnetBalance, getMainnetCUEBalance, pendingWithdrawal,
  depositCUE, withdrawCUE, resumeWithdrawal, sendCUE, sendETH
} = require('./tokenFunctions');

function generateMnemonic() {
  return bip39.generateMnemonic();
}

function getLoomPublicKeyFromMnemonic(mnemonic) {
  const seed = mnemonicToSeed(mnemonic);
  const privateKey = CryptoUtils.generatePrivateKeyFromSeed(seed);
  const publicKey = CryptoUtils.publicKeyFromPrivateKey(privateKey);
  return LocalAddress.fromPublicKey(publicKey).toString();
}

function generateLoomPrivateKeyShamir(mnemonic) {
  const seed = mnemonicToSeed(mnemonic);
  const privateKey = CryptoUtils.generatePrivateKeyFromSeed(seed);
  const privateKeyHex = toHexString(privateKey);
  const shares = shamir.share(privateKeyHex, 2, 2);
  return shares;
}

function getEthereumPublicKeyFromMnemonic(mnemonic) {
  const hdwallet = hdkey.fromMasterSeed(bip39.mnemonicToSeed(mnemonic));
  const walletHdPath = "m/44'/60'/0'/0/";
  const wallet = hdwallet.derivePath(`${ walletHdPath }0`).getWallet();
  return `0x${ wallet.getAddress().toString('hex') }`;
}

function generateEthereumPrivateKeyShamir(mnemonic) {
  const hdwallet = hdkey.fromMasterSeed(bip39.mnemonicToSeed(mnemonic));
  const walletHdPath = "m/44'/60'/0'/0/";
  const wallet = hdwallet.derivePath(`${ walletHdPath }0`).getWallet();
  const privateKey = wallet.getPrivateKey().toString('hex');
  const shares = shamir.share(privateKey, 2, 2);
  return shares;
}

exports.FromHexString = fromHexString;
exports.GenerateMnemonic = generateMnemonic;
exports.MnemonicToSeed = mnemonicToSeed;
exports.GetLoomPublicKeyFromMnemonic = getLoomPublicKeyFromMnemonic;
exports.GenerateLoomPrivateKeyShamir = generateLoomPrivateKeyShamir;
exports.GetEthereumPublicKeyFromMnemonic = getEthereumPublicKeyFromMnemonic;
exports.GenerateEthereumPrivateKeyShamir = generateEthereumPrivateKeyShamir;
exports.BuildPrivateKeyShamir = buildPrivateKeyShamir;
exports.BuildPrivateKeyShamirHex = buildPrivateKeyShamirHex;

exports.PlasmaContracts = plasma.PlasmaContracts;
exports.MapAccounts = mapAccounts;
exports.GetMainnetBalance = getMainnetBalance;
exports.GetMainnetCUEBalance = getMainnetCUEBalance;
exports.DepositCUE = depositCUE;
exports.WithdrawCUE = withdrawCUE;
exports.ResumeWithdrawal = resumeWithdrawal;
exports.PendingWithdrawal = pendingWithdrawal;
exports.SendCUE = sendCUE;
exports.SendETH = sendETH;
