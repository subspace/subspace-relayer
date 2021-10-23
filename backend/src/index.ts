import { ApiPromise, WsProvider } from "@polkadot/api";
import type { BN } from '@polkadot/util';

import { getAccount } from "./account";
import Config, { sourceChains } from "./config";
import Source from "./source";
import Target from "./target";
import logger from "./logger";
import { createParachainsMap } from './utils';
import { ChainName } from './types';
import State from './state';

const config = new Config({
  accountSeed: process.env.ACCOUNT_SEED,
  targetChainUrl: process.env.TARGET_CHAIN_URL,
  sourceChains,
});

const createApi = async (url: string) => {
  const provider = new WsProvider(url);
  const api = await ApiPromise.create({
    provider,
  });

  return api;
};

// TODO: remove IIFE when Eslint is updated to v8.0.0 (will support top-level await)
(async () => {
  try {
    const state = new State({ folder: "./state" });
    const targetApi = await createApi(config.targetChainUrl);

    const target = new Target({ api: targetApi, logger, state });

    const sources = await Promise.all(
      config.sourceChains.map(async ({ url, parachains }) => {
        const api = await createApi(url);
        const chain = await api.rpc.system.chain();
        const sourceSigner = getAccount(`${config.accountSeed}/${chain}`);
        const paraSigners = parachains.map(({ paraId }) => getAccount(`${config.accountSeed}/${paraId}`));

        // TODO: can be optimized by sending batch of txs
        // TODO: master has to delegate spending to sourceSigner and paraSigners
        const master = getAccount(config.accountSeed);
        for (const delegate of [sourceSigner, ...paraSigners]) {
          // send 1.5 units
          await target.sendBalanceTx(master, delegate, 1.5);
        }

        // check if feed already exists
        const feedId = await target.getFeedId(sourceSigner);
        const parachainsMap = await createParachainsMap(target, parachains, paraSigners);

        return new Source({
          api,
          chain: chain.toString() as ChainName,
          parachainsMap,
          logger,
          feedId,
          signer: sourceSigner,
          state,
        });
      })
    );

    sources.forEach(source => {
      let hasResynced = false;
      let lastFinalizedBlock: BN;

      async function execute() {
        await new Promise<void>((resolve, reject) => {
          try {
            if (hasResynced) {
              source.subscribeNewBlocks().subscribe({
                next: target.sendBlockTx,
              });
            } else {
              source.subscribeHeads().subscribe({
                next: header => {
                  if (!lastFinalizedBlock) {
                    lastFinalizedBlock = header.number.toBn();
                    resolve();
                  } else {
                    lastFinalizedBlock = header.number.toBn();
                  }
                }
              });
            }
          } catch (error) {
            if (!lastFinalizedBlock) {
              reject(error);
            } else {
              logger.error((error as Error).message);
            }
          }
        });

        source.resyncBlocks().subscribe({
          next: target.sendBlockTx,
          complete: () => {
            hasResynced = true;
            execute();
          }
        });
      }

      execute();
    });
  } catch (error) {
    logger.error((error as Error).message);
  }
})();
