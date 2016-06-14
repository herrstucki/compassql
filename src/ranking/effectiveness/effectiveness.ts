import {SpecQueryModel} from '../../model';
import {EncodingQuery, QueryConfig} from '../../query';
import {Stats} from '../../stats';
import {Dict} from '../../util';

import {TypeChannelScore, MarkChannelScore} from './channel';
import {MarkScore} from './mark';

export interface FeatureScore {
  score: number;
  type: string;
  feature: string;
}

export interface FeatureInitializer {
  (): Dict<number>;
}

export interface Featurizer {
  (specM: SpecQueryModel, stats: Stats, opt: QueryConfig): FeatureScore[];
}

export interface FeatureFactory {
  type: string;
  init: FeatureInitializer;
  getScore: Featurizer;
}


export let FEATURE_INDEX = {} as Dict<Dict<number>>;
let FEATURE_FACTORIES: FeatureFactory[] = [];

export function getFeatureScore(type: string, feature: string): FeatureScore {
  const score = FEATURE_INDEX[type][feature];
  if (score !== undefined) {
    return {
      score: score,
      type: type,
      feature: feature
    };
  }
  return null;
}

export function addFeatureFactory(factory: FeatureFactory) {
  FEATURE_FACTORIES.push(factory);
  FEATURE_INDEX[factory.type] = factory.init();
}

addFeatureFactory({
  type: TypeChannelScore.TYPE_CHANNEL,
  init: TypeChannelScore.init,
  getScore: TypeChannelScore.getScore
});

addFeatureFactory({
  type: MarkChannelScore.MARK_CHANNEL,
  init: MarkChannelScore.init,
  getScore: MarkChannelScore.getScore
});

addFeatureFactory({
  type: MarkScore.MARK_SCORE,
  init: MarkScore.init,
  getScore: MarkScore.getScore
});

// TODO: x/y, row/column preference
// TODO: stacking
// TODO: Channel, Cardinality
// TODO: Penalize over encoding

export function getExtendedType(encQ: EncodingQuery) {
  return (encQ.bin ? 'bin_' : encQ.timeUnit ? 'timeUnit_' : '') + encQ.type;
}


export default function (specM: SpecQueryModel, stats: Stats, opt: QueryConfig) {
  const features = FEATURE_FACTORIES.reduce((f, factory) => {
    return f.concat(factory.getScore(specM, stats, opt));
  }, [] as FeatureScore[]);

  return {
    score: features.reduce((s, f) => {
      return s + f.score;
    }, 0),
    features: features
  };
}