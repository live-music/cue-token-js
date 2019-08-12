
const { LocalAddress, CryptoUtils } = require('loom-js');
const Wallet = require('ethereumjs-wallet');
const moment = require('moment');

const {
  GenerateMnemonic,
  GenerateEthereumPrivateKeyShamir,
  GenerateLoomPrivateKeyShamir,
  BuildPrivateKeyShamir,
  PlasmaContracts
} = require('./index.js');

const { buildPrivateKeyShamirHex } = require('./utils');
const { mapAccounts, getMainnetBalance, getMainnetCUEBalance, withdrawCUE } = require('./tokenFunctions');

const mnemonic = GenerateMnemonic();
console.log(mnemonic);

let clientKeyShare;
let serverKeyShare;
let ethKey;
let loomKey;

// LOOM PK TESTS
function testLoomPK() {
  const shamirShares = GenerateLoomPrivateKeyShamir(mnemonic);
  clientKeyShare = shamirShares[0];
  serverKeyShare = shamirShares[1];
  const check = buildPrivateKeyShamirHex(shamirShares[0], shamirShares[1]);
  loomKey = check;
  const comparePublicKey = CryptoUtils.publicKeyFromPrivateKey(check);
  console.log('LOOM PUBLIC KEY BUILT', LocalAddress.fromPublicKey(comparePublicKey).toString());
}

// ETHEREUM PK TESTS
function testEthereumPK() {
  const shamirShares = GenerateEthereumPrivateKeyShamir(mnemonic);
  const check = BuildPrivateKeyShamir(shamirShares[0], shamirShares[1]);
  ethKey = check;
  const checkBuffer = Buffer.from(check, 'hex');
  const comparePublicKey = `0x${ Wallet.fromPrivateKey(checkBuffer).getAddress().toString('hex') }`;
  console.log('ETHEREUM PUBLIC KEY BUILT', comparePublicKey);
}

const contract = new PlasmaContracts();
async function loadPlasmaContracts() {
  const privateKey = buildPrivateKeyShamirHex(clientKeyShare, serverKeyShare);
  console.log('LOADING', clientKeyShare, serverKeyShare, privateKey);
  await contract.loadContract('extdev', privateKey);
  await contract._createCurrentUserAddress();
  console.log('LOOM CUE BALANCE', await contract.getBalance());
  // testBooking();
  // cancelBooking();
}

async function testBooking() {
  const now = moment(new Date());
  const START_TIME = new moment(now).add('4', 'days');
  const END_TIME = new moment(START_TIME).add('4', 'hours');
  await contract.newBooking('test2', '0x2c8cde218df2cebfa0209c6da47698fe8de3b0e7', 250000, START_TIME.unix(), END_TIME.unix());
  const booking = await contract.getBooking('test2');
  console.log('GOT BOOKING', booking);
}

async function map(environment) {
  await mapAccounts(environment, ethKey, loomKey);
}

async function cancelBooking() {
  const booking = await contract.cancelBooking('test2');
  console.log('CANCELED BOOKING', booking);
}

async function getEthBalance(environment) {
  const balance = await getMainnetBalance(environment, ethKey);
  console.log('MAINNET ETH BALANCE', balance);
}

async function getCUEBalance(environment) {
  const balance = await getMainnetCUEBalance(environment, ethKey);
  console.log('MAINNET CUE BALANCE', balance);
}

async function withdrawCUEFromLoom(environment, amount) {
  await withdrawCUE(environment, ethKey, loomKey, amount);
}

testLoomPK();
testEthereumPK();
loadPlasmaContracts();
getEthBalance('dev');
getCUEBalance('dev');
// withdrawCUEFromLoom('dev', 24);
// map('dev');
