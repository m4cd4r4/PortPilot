// src/core/appClusters.js is a UMD file: it sets window.PortPilotClusters as a side effect and is not an ES module.
import '../../src/core/appClusters.js';
import type { Card, CardState } from './model';

export interface Cluster { key: string; name: string; head: Card; state: CardState; members: Card[] }
interface ClusterApi { clusterCards(cards: Card[]): Cluster[] }
export const clusterCards = (cards: Card[]): Cluster[] => ((window as any).PortPilotClusters as ClusterApi).clusterCards(cards);
