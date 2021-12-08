import React, { useContext, useEffect, useState } from "react";
import { ApiPromise } from "@polkadot/api";
import { logger } from "@polkadot/util";
import { Header } from "@polkadot/types/interfaces";
import { from } from "rxjs";
import { allChains } from "config/AvailableParachain";
import { Totals, ParachainFeed, FeedTotals } from "config/interfaces/Parachain";
import { RelayerContextProviderProps, RelayerContextType, ApiPromiseContext } from "context";

const l = logger("relayer-context");

function allChainFeeds(): number[] {
  return allChains.map((chain) => chain.feedId);
}

function extractFeed(api: ApiPromise, args: any[]): ParachainFeed {
  const id: number = api.registry.createType("u64", args[0]).toNumber();
  const metadata = api.registry.createType("Bytes", args[2]).toHuman();
  const { hash, number } = JSON.parse(metadata?.toString() || "{}");
  return {
    feedId: id,
    hash: hash || "",
    number: number || "",
    size: 0,
    count: 0,
    subspaceHash: "",
  };
}

async function getFeedTotals(api: ApiPromise): Promise<FeedTotals[]> {
  const feedsTotals: FeedTotals[] = [];
  const totals = await api.query.feeds.totals.multi(allChainFeeds());
  for (let i = 0; i < totals.length; i++) {
    const feedTotal: Totals = api.registry.createType("Totals", totals[i]);
    feedsTotals.push({
      feedId: i,
      size: feedTotal.size_.toNumber(),
      count: feedTotal.count.toNumber(),
    });
  }
  return feedsTotals;
}

async function getInitFeeds(api: ApiPromise): Promise<ParachainFeed[]> {
  const feeds: ParachainFeed[] = [];
  const [feedsMetadata, totals] = await Promise.all([api.query.feeds.metadata.multi(allChainFeeds()), getFeedTotals(api)]);
  if (feedsMetadata.length === totals.length) {
    for (let i = 0; i < feedsMetadata.length; i++) {
      const feedMetadata = feedsMetadata[i].toHuman()?.toString();
      feeds.push({
        feedId: i,
        ...JSON.parse(feedMetadata || "{}"),
        size: totals[i].size,
        count: totals[i].count,
      });
    }
  }
  return feeds;
}

async function getNewFeeds(api: ApiPromise, { hash }: Header, oldFeeds: ParachainFeed[]): Promise<ParachainFeed[]> {
  const subspaceHash = hash.toString();
  const [{ block }, totals] = await Promise.all([api.rpc.chain.getBlock(subspaceHash), getFeedTotals(api)]);
  let newFeeds: ParachainFeed[] = [...oldFeeds];

  block.extrinsics.forEach(({ method: { method, section, args } }) => {
    let newFeed: ParachainFeed | undefined;
    if (section === "utility" && method === "batchAll") {
      // It assumes that a batchAll contains a Vec of put calls, for one feedId.
      // This way it is possible to get the feedId from the first argument of the put call
      const batchCalls: any = args[0];
      for (const { args } of batchCalls) {
        // Using 3 args feedId, data, metadata.
        if (args?.length === 3) {
          l.log(`New FEED FOUND! ON - ${section}.${method} `, args[0]);
          newFeed = extractFeed(api, args);
          break;
        }
      }
    } else if (section === "feeds" && method === "put" && args.length === 3) {
      l.log(`New FEED FOUND! ON - ${section}.${method} `, args[0]);
      newFeed = extractFeed(api, args);
    }

    if (newFeed) {
      const { feedId } = newFeed;
      l.log(`New FEED ADDED! - extracted `, feedId);
      newFeeds[feedId] = {
        ...newFeed,
        ...totals[feedId],
        subspaceHash,
      };
    }
  });
  return newFeeds;
}

export const RelayerContext: React.Context<RelayerContextType> = React.createContext({} as RelayerContextType);

export function RelayerContextProvider(props: RelayerContextProviderProps): React.ReactElement {
  const { children = null } = props;
  const { api, isApiReady } = useContext(ApiPromiseContext);
  const [header, setHeader] = useState<Header>();
  const [parachainFeeds, setParachainFeeds] = useState<ParachainFeed[]>([]);
  const [firstLoad, setFirstLoad] = useState<boolean>(true);

  // Get feeds for the first load.
  useEffect(() => {
    if (!isApiReady || !api || !firstLoad) return;
    const sub = from(getInitFeeds(api)).subscribe((initFeeds) => {
      setParachainFeeds(initFeeds);
      setFirstLoad(false);
    });
    return (): void => sub.unsubscribe();
  }, [isApiReady, api, firstLoad]);

  // Get new header using a subscription, to avoid missing blocks.
  useEffect(() => {
    if (!isApiReady || !api || firstLoad) return;
    api.rpc.chain.subscribeNewHeads((header) => {
      setHeader(header);
    });
  }, [isApiReady, api, firstLoad]);

  // If we get a new header, get new feeds.
  useEffect(() => {
    if (!isApiReady || !api || !header) return;
    if (header) {
      const sub = from(getNewFeeds(api, header, parachainFeeds)).subscribe((newFeeds) => {
        setParachainFeeds(newFeeds);
      });
      return (): void => sub.unsubscribe();
    }
  }, [isApiReady, api, header]);

  return <RelayerContext.Provider value={{ parachainFeeds }}>{children}</RelayerContext.Provider>;
}
