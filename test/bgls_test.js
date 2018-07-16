const chai = require('chai');
const dirtyChai = require('dirty-chai');
const BigNumber = require('bignumber.js');
const bgls = require('../src/bglswrapper.js');
const _ = require('lodash');


// import expectRevert from './helpers/expectRevert';

// Run tests:  scripts/test.sh

// Step-by-step debugging in VSCode:
// npm install truffle-core --save-dev
// node --inspect-brk ./node_modules/truffle-core/cli.js test test/bgls_test.js
// "Attach" in VSCode (see .vscode/launch.json)

// Print exec + tx cost for every contract call

// Add json.Marshal to Go when it returns from getCommitInputs
// Parse on JS side (this file)
// Send as param (single string) to Go's SignAndVerify() and parse there with json.Unmarshal.
// Destructure and use as params for SignAndVerify()
// Inside SignAndVerify() use dkg_test.go as blueprint.
// Listen to event after commit to know when we are done.


const {
  expect
} = chai;
chai.use(dirtyChai);

const ETH_URL = "http://127.0.0.1:7545";
// const CONTRACT_ADDRESS = '0xF7d58983Dbe1c84E03a789A8A2274118CC29b5da';
const Web3 = require('web3');

// See https://github.com/ethereum/web3.js/issues/1119
Web3.providers.HttpProvider.prototype.sendAsync = Web3.providers.HttpProvider.prototype.send;
const web3 = new Web3(new Web3.providers.HttpProvider(ETH_URL));

const CLIENT_COUNT = 5;
const THRESHOLD = 2;
const DEPOSIT_WEI = 1000000000000000000; // 1e18

const CLIENTS = [{
  address: '0x6E0C57E9B3a8BfDe94e89105b78A7f8bc40e85A0',
  privateKey: 'a05e8bd12f53f6063feae2623273cca6f0747574c3101537ea1f5602737dc97e',
},
  {
    address: '0xc761554c5EBE2303163fdb8319c0bA5b6bAB6526',
    privateKey: '9f47537b57875335b059ad59ce1c4a02b2504158ee8df36879ef44723f364deb',
  },
  {
    address: '0xa9C4381A5f6f9C7B8d525696436184B5f8763154',
    privateKey: '16b92ef93d268d20ec5078ef17b35605e7ba800a198b6916fbdc86bfced6f060',
  },
  {
    address: '0xA590aB8FFfb627C78c1632Ea986115f0c5d9f3bd',
    privateKey: 'ebf09917aac97a881851b828ce4e3e45d7fb7071577456ea932b17ec0fa04507',
  },
  {
    address: '0x501106e7c52dBe89A8a67378A17586649E053C25',
    privateKey: '4fd18d7b4d391ffede4d2f7691de47252be47bda95f10bcfe7ee399d181a8723',
  }
];


const DKGG2 = artifacts.require('../contracts/dkgG2.sol');
let dkgContract;
let allCommitDataJson;

contract('DKG POC', (accounts) => {
  it('should send transaction to DKG contract method join()', async () => {
    dkgContract = await DKGG2.new(THRESHOLD, CLIENT_COUNT, DEPOSIT_WEI);
    console.log(`Deployed DKG contract on address ${dkgContract.address}, txHash: ${dkgContract.transactionHash}`);
    await joinAllClients();
  });

  it('should use BGLS to calculate coefficients, G1, G2, prv data for commit()', async () => {
    const outputPath = bgls.GetCommitDataForAllParticipants(THRESHOLD, CLIENT_COUNT);
    allCommitDataJson = require(outputPath);
    console.log('Read contents of file ', outputPath);
    // console.log(`Commit Data: ${JSON.stringify(allCommitDataJson)}`);
  });

  it('should send transaction to DKG contract method commit()', async () => {
    await commitAllClients(allCommitDataJson);
  });

  it('should send transaction to DKG contract method closeContract()', async () => {
    console.log('Block number before: ', web3.eth.blockNumber);
    await closeContract(CLIENTS[0]);
    console.log('Block number after: ', web3.eth.blockNumber);
  });

  it.skip('should use BGLS to sign and verify a sample message', async () => {
    bgls.SignAndVerify(THRESHOLD, CLIENT_COUNT);
  });
});

async function join(client, i) {
  console.log(`Calling join() with client #${i} ${client.address}`);
  const res = await dkgContract.join({
    from: client.address,
    value: DEPOSIT_WEI,
    gasLimit: 3000000,
  });
  // console.log(`Client #${i} ${client.address} joined successfully.`);
  console.log(`Client #${i} ${client.address} joined successfully. Result: ${JSON.stringify(res)}`);
  client.id = null;
  for (let j = 0; j < res.logs.length; j++) {
    var log = res.logs[j];

    if (log.event === "ParticipantJoined") {
      client.id = log.args.index;
      console.log(`Client #${i} received ID [${client.id}] from join()`);
      break;
    }
  }
  if (client.id === null) {
    throw new Error(`Client #${i} did not receive an ID from join(), cannot continue`);
  }
  console.log("-----------------");
  return res;
}

async function joinAllClients() {
  console.log('=====> join <=====');
  const promises = [];


  //
  //
  // CLIENTS.reduce((prev, current) => {
  //   prev.then
  // }, Promise.resolve());

  let i=0;
  for (const client of CLIENTS) {
    console.log("Calling ", i);
    await join(client, i);
    i++;
  }

  // CLIENTS.forEach((client, i) => {
  //   promises.push(join(client, i));
  // });
  // const res = await Promise.all(promises);
  // return res;
}

/// Commit

async function commitAllClients(json) {
  console.log(` =====> commit <=====`);
  const promises = [];
  // console.log("commitAllClients(): allData=", JSON.stringify(json));
  const {CoefficientsAll, PubCommitG1All, PubCommitG2All, PrvCommitAll} = json;
  CLIENTS.forEach((client, i) => {
    console.log(`Calling commit() with client #${i} ${client.address}`);
    promises.push(commit(client, i, CoefficientsAll[i], PubCommitG1All[i], PubCommitG2All[i], PrvCommitAll[i]));
  });
  promises.push(() => {
    setTimeout(1000);
  });
  const res = await Promise.all(promises);

  // Decide if we want to run VerifyPublicCommitment, VerifyPrivateCommitment here

  return res;
}


async function commit(client, i, coeffs, commitG1, commitG2, commitPrv) {

  // const data = await dkgwrapper.GetCommitDataForAllParticipants(client, i);
  // const {pubCommitG1, pubCommitG2, prCommit} = data;

  // const pubCommitG1 = getPubCommitG1();
  // const pubCommitG2 = getPubCommitG2();
  // const prCommit = getPrCommit();
  if (!client.id) {
    throw new Error(`Missing client id for client #${i}. Client id is the result of join(). Did join() finished correctly?`);
  }

  // TODO: each "e" below is a pair or a quad, not a single string, so toBiGNumber() on it fails.
  // Instead, convert each "e" to and array of big numbers and then flatMap commitG1 so the resulting array will be x0,y0,x1,y1,... coords
  // FIXME: what is e?????????? it doesn't work.
  const commitG1BigInts = commitG1.map(e => e.map(numstr => { const biggie = web3.toBigNumber(numstr); /*console.log(`numstr: ${numstr} biggie: ${biggie}`); */return biggie;}));
  const commitG2BigInts = commitG2.map(e => e.map(numstr => web3.toBigNumber(numstr)));
  const prvBigInts = commitPrv.map(numstr => web3.toBigNumber(numstr));

  console.log(`===> Commit(ID=${client.id}) <===`);
  console.log(`commitG1BigInts: ${JSON.stringify(commitG1BigInts)}`);
  console.log(`commitG2BigInts: ${JSON.stringify(commitG2BigInts)}`);
  console.log(`commitPrvBigInts=${JSON.stringify(prvBigInts)}`);
  const g1Flat = _.flatMap(commitG1BigInts);
  const g2Flat = _.flatMap(commitG2BigInts);
  console.log(`g1Flat: ${JSON.stringify(g1Flat)}`);
  console.log(`g2Flat: ${JSON.stringify(g2Flat)}`);
  const res = await dkgContract.commit(client.id, g1Flat, g2Flat, prvBigInts, {
    from: client.address,
    gasLimit: 3000000
  });

  // Each client saves the pubCommitG1 and pubCommitG2 of ALL clients (save under its sender index),
  // prCommit[] is an array of bigints (f(i))(2) for all client indexes, but generated with the current client's coeffs.

  for (let j = 0; j < res.logs.length; j++) {
    var log = res.logs[j];

    if (log.event === "NewCommit") {
      console.log(`Client ID #${client.id} received NewCommit: ${JSON.stringify(log)}`);
      // client.id = log.args.index;
      // console.log(`Client #${i} received ID [${client.id}] from join()`);
      break;
    }
  }




  console.log(`Commit(): Client ID #${client.id} ${client.address} committed successfully. Result: ${JSON.stringify(res)}`);
}


async function closeContract(client) {

// TODO Client 0 to call dkgContract.phaseChange() and verify it runs. Don't send deposit.
// TODO return how much gas was spent for all calls for each client
// Separate to execution cost (function of opcodes) and transaction cost (execution cost + fixed cost per tx)

  await mineNBlocks(11);
  const res = await dkgContract.phaseChange({
    from: client.address,
    gasLimit: 3000000
  });


  console.log(`phaseChange(): finished successfully. Result: ${JSON.stringify(res)}`);


}

const mineOneBlock = async () => {
  console.log(JSON.stringify(web3.eth));

  await web3.currentProvider.send({
    jsonrpc: '2.0',
    method: 'evm_mine',
    params: [],
    id: 200,
  });
};

const mineNBlocks = async n => {
  for (let i = 0; i < n; i++) {
    await mineOneBlock()
  }
};

/*
function getCommitInputs() {
  const cmd = `${CWD}/dkgmain -func=GetCommitInputs`;
  const stdoutBuffer = execSync(cmd, {cwd: CWD});
  console.log(stdoutBuffer.toString());

}

// This should call Go code - it is just a mock here
function getPubCommitG1() {

  const SOME_BIG_NUMBER = '0xfc9e0eefe9f3a5101b7c025b217c03c95dbf9bb4f2d1d46db238e305af104103';
  const res = [];
  const pubCommitLength = THRESHOLD * 2 + 2;
  for (let i = 0; i < pubCommitLength; i++) {
    res.push(web3.toBigNumber(SOME_BIG_NUMBER));
  }
  return res;
}

function getPubCommitG2() {

  const SOME_BIG_NUMBER = '0xfc9e0eefe9f3a5101b7c025b217c03c95dbf9bb4f2d1d46db238e305af104103';
  const res = [];
  const pubCommitLength = THRESHOLD * 2 + 2;
  for (let i = 0; i < pubCommitLength; i++) {
    res.push(web3.toBigNumber(SOME_BIG_NUMBER));
  }
  return res;
}


// This should call Go code - it is just a mock here
function getPrCommit() {
  const ANOTHER_BIG_NUMBER = '0xfc9e0eefe9f3a5101b7c025b217c03c95dbf9bb4f2d1d46db238e305af104104';
  const res = [];
  const prCommitLength = CLIENT_COUNT;
  for (let i = 0; i < prCommitLength; i++) {
    res.push(web3.toBigNumber(ANOTHER_BIG_NUMBER));
  }
  return res;
}

*/