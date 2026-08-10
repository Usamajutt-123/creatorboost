'use client';

import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
  Legend,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
  Legend
);

const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function HeroChart() {
  const data = {
    labels,
    datasets: [
      {
        data: [120, 180, 240, 220, 280, 320, 290],
        borderColor: '#a78bfa',
        borderWidth: 3,
        pointRadius: 0,
        tension: 0.45,
        fill: true,
        backgroundColor: (context: any) => {
          const chart = context.chart;
          const { ctx, chartArea } = chart;

          if (!chartArea) return 'rgba(167,139,250,0.25)';

          const gradient = ctx.createLinearGradient(
            0,
            chartArea.top,
            0,
            chartArea.bottom
          );

          gradient.addColorStop(0, 'rgba(167,139,250,0.35)');
          gradient.addColorStop(1, 'rgba(167,139,250,0)');

          return gradient;
        },
      },
    ],
  };

  const options: any = {
    responsive: true,
    maintainAspectRatio: false,

    layout: {
      padding: {
        left: 10,
        right: 10,
        top: 8,
        bottom: 8,
      },
    },

    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: false,
      },
    },

    scales: {
      x: {
        display: false,
        offset: true,
        grid: {
          display: false,
          drawBorder: false,
        },
      },
      y: {
        display: false,
        beginAtZero: false,
        grace: '15%',
        grid: {
          display: false,
          drawBorder: false,
        },
      },
    },

    elements: {
      line: {
        capBezierPoints: true,
      },
    },

    animation: {
      duration: 1200,
      easing: 'easeOutQuart',
    },
  };

  return (
    <div className="relative w-full h-full overflow-hidden">
      <Line data={data} options={options} />
    </div>
  );
}