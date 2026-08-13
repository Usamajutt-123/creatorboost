'use client';

/**
 * Single Chart.js entry point.
 *
 * Every chart in the app previously imported `chart.js` + `react-chartjs-2`
 * directly and called `ChartJS.register(...)` at module scope, which pulled the
 * whole charting runtime (~180 KB) into the *initial* JavaScript of the home
 * page, the creator dashboard, analytics and the admin dashboard.
 *
 * This module is loaded through `./LazyChart`, so the charting runtime lives in
 * its own chunk instead of the page's first-load JavaScript. The registration
 * list below is the union of what the individual chart components used to
 * register; the Chart.js registry is global, so registering the union is
 * exactly equivalent to the previous per-component registrations.
 */

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Filler,
  Legend,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Filler, Legend);

export { Line, Bar, Doughnut };
