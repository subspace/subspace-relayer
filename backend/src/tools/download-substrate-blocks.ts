// Small utility that can download blocks from Substrate-based chain starting from genesis and store them by block
// number in a directory

// TODO: Types do not seem to match the code, hence usage of it like this
// eslint-disable-next-line @typescript-eslint/no-var-requires
const levelup = require("levelup");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const rocksdb = require("rocksdb");
import pRetry from "p-retry";

import HttpApi from '../httpApi';
import { blockNumberToBuffer } from '../utils';

const REPORT_PROGRESS_INTERVAL = process.env.REPORT_PROGRESS_INTERVAL
  ? parseInt(process.env.REPORT_PROGRESS_INTERVAL, 10)
  : 100;

let shouldStop = false;

process
  .on('SIGINT', () => {
    console.log('Got SIGINT, will stop as soon as possible');
    shouldStop = true;
  })
  .on('SIGTERM', () => {
    console.log('Got SIGTERM, will stop as soon as possible');
    shouldStop = true;
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAndStoreBlock(sourceChainRpc: string, blockNumber: number, db: any): Promise<void> {
  const httpApi = new HttpApi(sourceChainRpc);

  const [blockHash, blockBytes] = await pRetry(
    () => httpApi.getBlockByNumber(blockNumber),
  );

  const blockNumberAsBuffer = blockNumberToBuffer(blockNumber);
  const blockHashAsBuffer = Buffer.from(blockHash.slice(2), 'hex');
  await db.put(
    blockNumberAsBuffer,
    Buffer.concat([
      // Block hash length in bytes
      Buffer.from(Uint8Array.of(blockHashAsBuffer.byteLength)),
      // Block hash itself
      blockHashAsBuffer,
      // Block bytes in full
      blockBytes,
    ]),
  );
  await db.put('last-downloaded-block', blockNumberAsBuffer);
}

(async () => {
  const sourceChainRpc = process.env.SOURCE_CHAIN_RPC;
  if (!(sourceChainRpc && sourceChainRpc.startsWith('http'))) {
    console.error("SOURCE_CHAIN_RPC environment variable must be set with HTTP RPC URL");
    process.exit(1);
  }

  const targetDir = process.env.TARGET_DIR;
  if (!sourceChainRpc) {
    console.error("TARGET_DIR environment variable must be set with directory where downloaded blocks must be stored");
    process.exit(1);
  }

  console.log("Retrieving last finalized block...");

  const httpApi = new HttpApi(sourceChainRpc);

  const lastFinalizedBlockNumber = await httpApi.getLastFinalizedBlock();

  console.info(`Last finalized block is ${lastFinalizedBlockNumber}`);

  console.log(`Downloading blocks into ${targetDir}`);

  const db = levelup(rocksdb(`${targetDir}/db`));

  let lastDownloadedBlock;
  try {
    // We know blocks will not exceed 53-bit integer
    lastDownloadedBlock = Number((await db.get('last-downloaded-block') as Buffer).readBigUInt64LE());
  } catch {
    lastDownloadedBlock = -1;
  }

  if (lastDownloadedBlock > -1) {
    console.info(`Continuing downloading from block ${lastDownloadedBlock + 1}`);
  }

  let lastDownloadingReportAt = Date.now();
  let blockNumber = lastDownloadedBlock + 1;

  for (; blockNumber <= lastFinalizedBlockNumber; ++blockNumber) {
    if (shouldStop) {
      break;
    }

    await fetchAndStoreBlock(sourceChainRpc, blockNumber, db);

    if (blockNumber > 0 && blockNumber % REPORT_PROGRESS_INTERVAL === 0) {
      const now = Date.now();
      const downloadingRate =
        `(${(Number(REPORT_PROGRESS_INTERVAL) / ((now - lastDownloadingReportAt) / 1000)).toFixed(2)} blocks/s)`;
      lastDownloadingReportAt = now;

      console.info(
        `Downloaded block ${blockNumber}/${lastFinalizedBlockNumber} ${downloadingRate}`
      );
    }
  }

  if (!shouldStop) {
    console.info("Archived everything, verifying and fixing up archive if needed");

    blockNumber = 0;

    let lastVerificationReportAt = Date.now();

    for (; blockNumber <= lastFinalizedBlockNumber; ++blockNumber) {
      if (shouldStop) {
        break;
      }

      const blockNumberAsBuffer = blockNumberToBuffer(blockNumber);
      try {
        await db.get(blockNumberAsBuffer);
      } catch (e) {
        console.log(`Found problematic block ${blockNumber} during archive verification, fixing it`);
        await fetchAndStoreBlock(sourceChainRpc, blockNumber, db);
      }

      if (blockNumber > 0 && blockNumber % REPORT_PROGRESS_INTERVAL === 0) {
        const now = Date.now();
        const verificationRate =
          `(${(Number(REPORT_PROGRESS_INTERVAL) / ((now - lastVerificationReportAt) / 1000)).toFixed(2)} blocks/s)`;
        lastVerificationReportAt = now;

        console.info(
          `Verified block ${blockNumber}/${lastFinalizedBlockNumber} ${verificationRate}`
        );
      }
    }
  }

  await db.close();

  process.exit(0);
})();
