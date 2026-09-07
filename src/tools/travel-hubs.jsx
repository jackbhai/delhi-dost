/**
 * Bus and metro hub compositions, in their own module on purpose.
 *
 * The transit datasets (2,564 bus directions with their timetables, the whole
 * metro network) are 2.4 MB of JSON.  Imported from App.jsx they would be part
 * of the bundle every visit downloads before the first tile paints; reached
 * through React.lazy from here they become two extra chunks that are fetched —
 * and then cached offline by the service worker — only when a Travel tool is
 * actually opened.  Music, the home grid and every other tool stay on the
 * original payload.
 */
import * as BP from './bus-planner';
import * as MP from './metro-planner';
import * as TL from './transit-live';
import * as T from './transit';
import { Hub } from './travel-hub';
import { TripBar } from './trip-ui.jsx';

/**
 * The floating get-off bar lives here rather than inside the shared Hub shell:
 * Hub is also used by the train tools, which are part of the start bundle, and
 * the trip store pulls in the transit data.  Mounting it from this module keeps
 * 2.4 MB of JSON behind the same lazy boundary it was already behind.
 */
const withTripBar = (node) => (<>{node}<TripBar /></>);

export function BusHub() {
  return withTripBar(
    <Hub icon="bus" title="Delhi Bus" sub="Plan a trip · what is due right now · fares"
      tabs={[
        { id: 'plan',   n: 'Plan trip',   i: 'route',  C: BP.BusPlanner },
        { id: 'live',   n: 'Right now',    i: 'signal', C: TL.BusLive },
        { id: 'routes', n: 'Routes',       i: 'list',   C: BP.BusRoutesList },
        { id: 'fare',   n: 'Fares',        i: 'fare',   C: BP.BusFares },
      ]} />);
}

export function MetroHub() {
  return withTripBar(
    <Hub icon="metro" title="Delhi Metro" sub="Plan a trip · line status, last train & fares"
      tabs={[
        { id: 'plan',  n: 'Plan route',   i: 'route', C: MP.MetroPlanner },
        { id: 'times', n: 'Right now',    i: 'clock', C: TL.MetroTimings },
        { id: 'net',   n: 'Network',      i: 'grid',  C: MP.MetroNetwork },
        { id: 'lines', n: 'Lines',        i: 'metro', C: T.MetroLines },
        { id: 'city',  n: 'Other cities', i: 'globe', C: T.Metro },
      ]} />);
}
