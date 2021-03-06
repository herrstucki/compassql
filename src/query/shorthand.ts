import {isAggregateOp} from 'vega-lite/build/src/aggregate';
import {Channel, isChannel} from 'vega-lite/build/src/channel';
import {Mark} from 'vega-lite/build/src/mark';
import {FacetedCompositeUnitSpec} from 'vega-lite/build/src/spec';
import {isTimeUnit} from 'vega-lite/build/src/timeunit';
import {Type, getFullName} from 'vega-lite/build/src/type';
import {isString} from 'datalib/src/util';
import {EncodingQuery, isFieldQuery, FieldQuery, isValueQuery, isDisabledAutoCountQuery, isEnabledAutoCountQuery, isAutoCountQuery, FieldQueryBase} from './encoding';
import {SpecQuery, stack, fromSpec} from './spec';
import {isWildcard, isShortWildcard, SHORT_WILDCARD} from '../wildcard';
import {getEncodingNestedProp, Property, hasNestedProperty, DEFAULT_PROP_PRECEDENCE, SORT_PROPS, EncodingNestedChildProp} from '../property';
import {PropIndex} from '../propindex';
import {Dict, keys, isArray, isBoolean} from '../util';

export type Replacer = (s: string) => string;

export function getReplacerIndex(replaceIndex: PropIndex<Dict<string>>): PropIndex<Replacer> {
  return replaceIndex.map(r => getReplacer(r));
}

export function getReplacer(replace: Dict<string>): Replacer {
  return (s: string) => {
    if (replace[s] !== undefined) {
      return replace[s];
    }
    return s;
  };
}

export function value(v: any, replacer: Replacer): any {
  if (isWildcard(v)) {
    // Return the enum array if it's a full wildcard, or just return SHORT_WILDCARD for short ones.
    if (!isShortWildcard(v) && v.enum) {
      return SHORT_WILDCARD + JSON.stringify(v.enum);
    } else {
      return SHORT_WILDCARD;
    }
  }
  if (replacer) {
    return replacer(v);
  }
  return v;
}

export function replace(v: any, replacer: Replacer): any {
  if (replacer) {
    return replacer(v);
  }
  return v;
}

export const REPLACE_NONE = new PropIndex<Replacer>();

export const INCLUDE_ALL: PropIndex<boolean> =
  // FIXME: remove manual TRANSFORM concat once we really support enumerating transform.
  [].concat(
    DEFAULT_PROP_PRECEDENCE,
    SORT_PROPS,
    [Property.TRANSFORM, Property.STACK]
  )
  .reduce((pi, prop: Property) => pi.set(prop, true), new PropIndex<boolean>());


export function vlSpec(vlspec: FacetedCompositeUnitSpec,
    include: PropIndex<boolean> = INCLUDE_ALL,
    replace: PropIndex<Replacer> = REPLACE_NONE) {
  const specQ = fromSpec(vlspec);
  return spec(specQ, include, replace);
}

export const PROPERTY_SUPPORTED_CHANNELS = {
  axis: {x: true, y: true, row: true, column: true},
  legend: {color: true, opacity: true, size: true, shape: true},
  scale: {x: true, y: true, color: true, opacity: true, row: true, column: true, size: true, shape: true},
  sort: {x: true, y: true, path: true, order: true}
};

/**
 * Returns a shorthand for a spec query
 * @param specQ a spec query
 * @param include Dict Set listing property types (key) to be included in the shorthand
 * @param replace Dictionary of replace function for values of a particular property type (key)
 */
export function spec(specQ: SpecQuery,
    include: PropIndex<boolean> = INCLUDE_ALL,
    replace: PropIndex<Replacer> = REPLACE_NONE
    ): string {
  const parts: string[] = [];

  if (include.get(Property.MARK)) {
    parts.push(value(specQ.mark, replace.get(Property.MARK)));
  }

  if (specQ.transform && specQ.transform.length > 0) {
    parts.push('transform:' + JSON.stringify(specQ.transform));
  }

  // TODO: extract this to its own stack method
  if (include.get(Property.STACK)) {
    const _stack = stack(specQ);
    if (_stack) {
      // TODO: Refactor this once we have child stack property.

      // Exclude type since we don't care about type in stack
      const includeExceptType = include.duplicate().set('type', false);

      const field = fieldDef(_stack.fieldEncQ, includeExceptType, replace);
      const groupby = _stack.groupByEncQ ? fieldDef(_stack.groupByEncQ, includeExceptType, replace) : undefined;

      parts.push(
        'stack={field:' + field + ',' +
        (groupby ? 'by:' + groupby + ',' : '') +
        'offset:' + _stack.offset + '}'
      );
    }
  }

  if (specQ.encodings) {
    const encodings = specQ.encodings.reduce((encQs, encQ) => {
        // Exclude encoding mapping with autoCount=false as they are basically disabled.
        if (!isDisabledAutoCountQuery(encQ)) {
          const str = encoding(encQ, include, replace);
          if (str) { // only add if the shorthand isn't an empty string.
            encQs.push(str);
          }
        }
        return encQs;
      }, [])
      .sort() // sort at the end to ignore order
      .join('|');

    if (encodings) {
      parts.push(encodings);
    }
  }

  return parts.join('|');
}


/**
 * Returns a shorthand for an encoding query
 * @param encQ an encoding query
 * @param include Dict Set listing property types (key) to be included in the shorthand
 * @param replace Dictionary of replace function for values of a particular property type (key)
 */
export function encoding(encQ: EncodingQuery,
    include: PropIndex<boolean> = INCLUDE_ALL,
    replace: PropIndex<Replacer> = REPLACE_NONE
    ): string {

  const parts = [];
  if (include.get(Property.CHANNEL)) {
    parts.push(value(encQ.channel, replace.get(Property.CHANNEL)));
  }

  if (isFieldQuery(encQ)) {
    const fieldDefStr = fieldDef(encQ, include, replace);
    if (fieldDefStr) {
      parts.push(fieldDefStr);
    }
  } else if (isValueQuery(encQ)) {
    parts.push(encQ.value);
  }

  return parts.join(':');
}

/**
 * Returns a field definition shorthand for an encoding query
 * @param encQ an encoding query
 * @param include Dict Set listing property types (key) to be included in the shorthand
 * @param replace Dictionary of replace function for values of a particular property type (key)
 */
export function fieldDef(encQ: EncodingQuery,
    include: PropIndex<boolean> = INCLUDE_ALL,
    replacer: PropIndex<Replacer> = REPLACE_NONE): string {

  if (include.get(Property.AGGREGATE) && isDisabledAutoCountQuery(encQ)) {
    return '-';
  }

  const fn = func(encQ, include, replacer);
  const props = fieldDefProps(encQ, include, replacer);

  let fieldAndParams;
  if (isFieldQuery(encQ)) {
    // field
    fieldAndParams = include.get('field') ? value(encQ.field, replacer.get('field')) : '...';
    // type
    if (include.get(Property.TYPE)) {
      if (isWildcard(encQ.type)) {
        fieldAndParams += ',' + value(encQ.type, replacer.get(Property.TYPE));
      } else {
        const typeShort = ((encQ.type || Type.QUANTITATIVE)+'').substr(0,1);
        fieldAndParams += ',' + value(typeShort, replacer.get(Property.TYPE));
      }
    }
    // encoding properties
    fieldAndParams += props.map((p) => {
      let val = p.value instanceof Array ? '[' + p.value + ']' : p.value;
      return ',' + p.key + '=' + val;
    }).join('');
  } else if (isAutoCountQuery(encQ)) {
    fieldAndParams = '*,q';
  }

  if (!fieldAndParams) {
    return null;
  }
  if (fn) {
    let fnPrefix = isString(fn) ? fn : SHORT_WILDCARD +
      (keys(fn).length > 0 ? JSON.stringify(fn) : '');

    return fnPrefix + '(' + fieldAndParams + ')';
  }
  return fieldAndParams;
}


/**
 * Return function part of
 */
function func(fieldQ: FieldQuery, include: PropIndex<boolean>, replacer: PropIndex<Replacer>): string | Object {
  if (include.get(Property.AGGREGATE) && fieldQ.aggregate && !isWildcard(fieldQ.aggregate)) {
    return replace(fieldQ.aggregate, replacer.get(Property.AGGREGATE));
  } else if (include.get(Property.AGGREGATE) && isEnabledAutoCountQuery(fieldQ)) {
    // autoCount is considered a part of aggregate
    return replace('count', replacer.get(Property.AGGREGATE));;
  } else if (include.get(Property.TIMEUNIT) && fieldQ.timeUnit && !isWildcard(fieldQ.timeUnit)) {
    return replace(fieldQ.timeUnit, replacer.get(Property.TIMEUNIT));
  } else if (include.get(Property.BIN) && fieldQ.bin && !isWildcard(fieldQ.bin)) {
    return 'bin';
  } else {
    let fn: any = null;
    for (const prop of [Property.AGGREGATE, Property.AUTOCOUNT, Property.TIMEUNIT, Property.BIN]) {
      const val = fieldQ[prop];
      if (include.get(prop) && fieldQ[prop] && isWildcard(val)) {

        // assign fnEnumIndex[prop] = array of enum values or just "?" if it is SHORT_WILDCARD
        fn = fn || {};
        fn[prop] = isShortWildcard(val) ? val : val.enum;
      }
    }
    if (fn && fieldQ.hasFn) {
      fn.hasFn = true;
    }
    return fn;
  }
}

/**
 * Return key-value of parameters of field defs
 */
function fieldDefProps(fieldQ: FieldQuery, include: PropIndex<boolean>, replacer: PropIndex<Replacer>) {

  /** Encoding properties e.g., Scale, Axis, Legend */
  const props: {key: string, value: boolean | Object}[] = [];

  // Parameters of function such as bin will be just top-level properties
  if (!isBoolean(fieldQ.bin) && !isShortWildcard(fieldQ.bin)) {
    const bin = fieldQ.bin;
    for (const child in bin) {
      const prop = getEncodingNestedProp('bin', child as EncodingNestedChildProp);
      if (prop && include.get(prop) && bin[child] !== undefined) {
        props.push({
          key: child,
          value: value(bin[child], replacer.get(prop))
        });
      }
    }
    // Sort to make sure that parameter are ordered consistently
    props.sort((a, b) => a.key.localeCompare(b.key));
  }

  for (const parent of [Property.SCALE, Property.SORT, Property.AXIS, Property.LEGEND]) {
    if (!isWildcard(fieldQ.channel) && !PROPERTY_SUPPORTED_CHANNELS[parent][fieldQ.channel as Channel]) {
      continue;
    }

    if (include.get(parent) && fieldQ[parent] !== undefined) {
      const parentValue = fieldQ[parent];
      if (isBoolean(parentValue) || parentValue === null) {
        // `scale`, `axis`, `legend` can be false/null.
        props.push({
          key: parent + '',
          value: parentValue || false // return true or false (false if null)
        });
      } else if (isString(parentValue)) {

        // `sort` can be a string (ascending/descending).
        props.push({
          key: parent + '',
          value: replace(JSON.stringify(parentValue), replacer.get(parent))
        });
      } else {
        let nestedPropChildren = [];
        for (const child in parentValue) {
          const nestedProp = getEncodingNestedProp(parent, child as EncodingNestedChildProp);
          if (nestedProp && include.get(nestedProp) && parentValue[child] !== undefined) {
            nestedPropChildren.push({
              key: child,
              value: value(parentValue[child], replacer.get(nestedProp))
            });
          }
        }

        if(nestedPropChildren.length > 0) {
          const nestedPropObject = nestedPropChildren.sort((a, b) => a.key.localeCompare(b.key))
            .reduce((o, item) => {
              o[item.key] = item.value;
              return o;
            }, {});

          // Sort to make sure that parameter are ordered consistently
          props.push({
            key: parent + '',
            value: JSON.stringify(nestedPropObject)
          });
        }
      }
    }
  }
  return props;
}

export function parse(shorthand: string): SpecQuery {
  // TODO(https://github.com/uwdata/compassql/issues/259):
  // Do not split directly, but use an upgraded version of `getClosingBraceIndex()`
  let splitShorthand = shorthand.split('|');

  let specQ: SpecQuery = {
    mark: splitShorthand[0] as Mark,
    encodings: [] as EncodingQuery[]
  };

  for (let i = 1; i < splitShorthand.length; i++) {
    let part = splitShorthand[i];
    const splitPart = splitWithTail(part, ':', 1);
    const splitPartKey = splitPart[0];
    const splitPartValue = splitPart[1];

    if (isChannel(splitPartKey) || splitPartKey === '?') {
      const encQ = shorthandParser.encoding(splitPartKey, splitPartValue);
      specQ.encodings.push(encQ);
      continue;
    }

    if (splitPartKey === 'transform') {
      specQ.transform = JSON.parse(splitPartValue);
      continue;
    }
  }

  return specQ;
}

/**
 * Split a string n times into substrings with the specified delimiter and return them as an array.
 * @param str The string to be split
 * @param delim The delimiter string used to separate the string
 * @param number The value used to determine how many times the string is split
 */
export function splitWithTail(str: string, delim: string, count: number): string[] {
  let result = [];
  let lastIndex = 0;

  for (let i = 0; i < count; i++) {
    let indexOfDelim = str.indexOf(delim, lastIndex);

    if (indexOfDelim !== -1) {
      result.push(str.substring(lastIndex, indexOfDelim));
      lastIndex = indexOfDelim + 1;
    } else {
      break;
    }
  }

  result.push(str.substr(lastIndex));

  // If the specified count is greater than the number of delimiters that exist in the string,
  // an empty string will be pushed count minus number of delimiter occurence times.
  if (result.length !== count + 1) {
    while (result.length !== count + 1) {
      result.push('');
    }
  }

  return result;
}

export namespace shorthandParser {
  export function encoding(channel: Channel | SHORT_WILDCARD, fieldDefShorthand: string): EncodingQuery {
    let encQMixins = fieldDefShorthand.indexOf('(') !== -1 ?
      fn(fieldDefShorthand) :
      rawFieldDef(splitWithTail(fieldDefShorthand, ',', 2));
    return {
      channel,
      ...encQMixins
    };
  }

  export function rawFieldDef(fieldDefPart: string[]): FieldQueryBase {
    const fieldQ: FieldQueryBase = {};
    fieldQ.field = fieldDefPart[0];
    fieldQ.type = getFullName(fieldDefPart[1].toUpperCase()) || '?';

    let partParams = fieldDefPart[2];
    let closingBraceIndex = 0;
    let i = 0;

    while (i < partParams.length) {
      let propEqualSignIndex = partParams.indexOf('=', i);
      let parsedValue;
      if (propEqualSignIndex !== -1) {
        let prop = partParams.substring(i, propEqualSignIndex);
        if (partParams[i + prop.length + 1] === '{') {
          let openingBraceIndex = i + prop.length + 1;
          closingBraceIndex = getClosingIndex(openingBraceIndex, partParams, '}');
          const value = partParams.substring(openingBraceIndex, closingBraceIndex + 1);
          parsedValue = JSON.parse(value);

          // index after next comma
          i = closingBraceIndex + 2;
        } else if (partParams[i + prop.length + 1] === '[') {
          // find closing square bracket
          let openingBracketIndex = i + prop.length + 1;
          let closingBracketIndex = getClosingIndex(openingBracketIndex, partParams, ']');
          const value = partParams.substring(openingBracketIndex, closingBracketIndex + 1);
          parsedValue = JSON.parse(value);

          // index after next comma
          i = closingBracketIndex + 2;
        } else {
          let propIndex = i;
          // Substring until the next comma (or end of the string)
          let nextCommaIndex = partParams.indexOf(',', i + prop.length);
          if (nextCommaIndex === -1) {
            nextCommaIndex = partParams.length;
          }
          // index after next comma
          i = nextCommaIndex + 1;

          parsedValue = JSON.parse(
            partParams.substring(
              propIndex + prop.length + 1,
              nextCommaIndex
            )
          );
        }

        if (hasNestedProperty(prop)) {
          fieldQ[prop] = parsedValue;
        } else {
          // prop is a property of the aggregation function such as bin
          fieldQ.bin = fieldQ.bin || {};
          fieldQ.bin[prop] = parsedValue;
        }
      } else {
        // something is wrong with the format of the partParams
        // exits loop if don't have then infintie loop
        break;
      }
    }
    return fieldQ;
  }


  export function getClosingIndex(openingBraceIndex: number, str: string, closingChar: string): number {
    for (let i = openingBraceIndex; i < str.length; i++) {
      if (str[i] === closingChar) {
        return i;
      }
    }
  }

  export function fn(fieldDefShorthand: string): FieldQueryBase {
    const fieldQ: FieldQueryBase = {};
    // Aggregate, Bin, TimeUnit as wildcard case
    if (fieldDefShorthand[0] === '?') {
      let closingBraceIndex = getClosingIndex(1, fieldDefShorthand, '}');

      let fnEnumIndex = JSON.parse(fieldDefShorthand.substring(1, closingBraceIndex + 1));

      for (let encodingProperty in fnEnumIndex) {
        if (isArray(fnEnumIndex[encodingProperty])) {
          fieldQ[encodingProperty] = {enum: fnEnumIndex[encodingProperty]};
        } else { // Definitely a `SHORT_WILDCARD`
          fieldQ[encodingProperty] = fnEnumIndex[encodingProperty];
        }
      }

      return {
        ...fieldQ,
        ...rawFieldDef(
          splitWithTail(fieldDefShorthand.substring(closingBraceIndex + 2, fieldDefShorthand.length - 1), ',', 2)
        )
      };
    } else {
      let func = fieldDefShorthand.substring(0, fieldDefShorthand.indexOf('('));
      let insideFn = fieldDefShorthand.substring(func.length + 1, fieldDefShorthand.length - 1);
      let insideFnParts = splitWithTail(insideFn, ',', 2);

      if (isAggregateOp(func)) {
        return {
          aggregate: func,
          ...rawFieldDef(insideFnParts)
        };
      } else if (isTimeUnit(func)) {
        return {
          timeUnit: func,
          ...rawFieldDef(insideFnParts)
        };
      } else if (func === 'bin') {
        return {
          bin: {},
          ...rawFieldDef(insideFnParts)
        };
      }
    }
  }
}
