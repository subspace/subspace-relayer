import React, { ReactElement, useContext, useEffect, useState } from "react";
import { Badge, Card, Container, Table, Spinner } from "reactstrap";
import { allChains } from "config/AvailableParachain";
import Header from "./Header";
import ParachainRow from "./ParachainRow";
import { ParachainFeed, ParachainProps } from "config/interfaces/Parachain";
import { RelayerContext } from "context";

const ParachainTable: React.FC = (): ReactElement => {
  const [parachainProps] = useState<ParachainProps[]>([...allChains]);
  const [filter, setFilter] = useState<number>(0);
  const [sortByBlock, setSortByBlock] = useState<boolean>(true);
  const [sortedFeeds, setSortedFeeds] = useState<[number, ParachainFeed][]>([]);
  const { feeds } = useContext(RelayerContext);

  useEffect(() => {
    // feedIds may change, so we find feedId by chain name before sorting
    const kusamaFeedId = allChains.find(chain => chain.chainName === 'Kusama')?.feedId;
    const polkadotFeedId = allChains.find(chain => chain.chainName === 'Polkadot')?.feedId;
    const sortedFeeds = [...feeds.entries()]
      .sort(([feedIdA, feedDataA], [feedIdB, feedDataB]) => {
        // Set Polkadot to the top position on table
        if (feedIdA === polkadotFeedId) return -1;
        if (feedIdB === polkadotFeedId) return 1;
        // Set Kusama to the second position on table
        if (feedIdA === kusamaFeedId) return -1;
        if (feedIdB === kusamaFeedId) return 1;

        if (sortByBlock) {
          return feedDataB.number - feedDataA.number;
        } else {
          return feedDataA.number - feedDataB.number;
        }
      });
    setSortedFeeds(sortedFeeds);
  }, [feeds, sortByBlock]);

  const updateSortByBlock = () => {
    setSortByBlock(!sortByBlock);
  };

  const getFilterColor = (filterIndex: number): string => {
    if (filterIndex === filter) return "badge-lg badge-cursor text-white";
    else return "badge-lg badge-cursor text-gray";
  };

  return (
    <div>
      <Header />
      <Container className="pt-2 ml-4">
        <Badge
          color={filter === 0 ? " bg-primary" : ""}
          onClick={() => setFilter(0)}
          className={getFilterColor(0)}
        >
          {"ALL CHAINS"}
        </Badge>
        <Badge
          color={filter === 1 ? " bg-gray-dark" : ""}
          onClick={() => setFilter(1)}
          className={getFilterColor(1)}
        >
          {"KUSAMA"}
        </Badge>
        <Badge
          color={filter === 2 ? " badge-pink" : ""}
          onClick={() => setFilter(2)}
          className={getFilterColor(2)}
        >
          {"POLKADOT"}
        </Badge>
      </Container>
      <Container className="pl-4 pr-4 pt-2" fluid>
        <Card className="shadow">
          <Table size="md" className="align-items-center" responsive>
            <thead className="thead-light">
              <tr>
                <th>{"Chains"}</th>
                <th>{"Last Updated"}</th>
                <th className="text-left">{"Last Block Hash"}</th>
                <th className="badge-cursor text-left" onClick={() => updateSortByBlock()}>
                  {"Last Block Height "}
                  <i className={!sortByBlock ? "fas fa-arrow-down" : "fas fa-arrow-up"}></i>
                </th>
                <th>{"Storage"}</th>
                <th className="text-right">{"Subspace Hash"}</th>
              </tr>
            </thead>
            <tbody>
              {sortedFeeds.map(([feedId, feed]) => {
                const prop = parachainProps.find((p) => p.feedId === feedId);
                if (prop) return <ParachainRow key={feedId} filter={filter} {...prop} {...feed} />;
              })}
              {sortedFeeds.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="text-center pb-2 pt-3">
                      <h3>Connecting and loading archives <Spinner
                        className="ml-2"
                        color="text-primary"
                        size={"sm"}
                      ></Spinner></h3>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card>
      </Container>
    </div>
  );
};

export default ParachainTable;
