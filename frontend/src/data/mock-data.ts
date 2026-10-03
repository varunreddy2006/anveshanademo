export const dashboardMetrics = [
  { label: 'Online cameras', value: '12', detail: '+2 in last 24h' },
  { label: 'Offline cameras', value: '2', detail: 'Awaiting maintenance' },
  { label: 'Monitored zones', value: '6', detail: 'Across 3 departments' },
  { label: 'PPE compliance', value: '91%', detail: 'Based on eligible detections' },
]

export const safetyInsights = [
  { title: 'Assembly line', risk: 'High', score: 72, color: 'amber' },
  { title: 'Chemical storage', risk: 'Critical', score: 88, color: 'red' },
  { title: 'Loading bay', risk: 'Moderate', score: 41, color: 'teal' },
  { title: 'Machine area', risk: 'High', score: 68, color: 'amber' },
]

export const recentAlerts = [
  { id: 'AL-204', zone: 'Chemical storage', type: 'Restricted zone entry', severity: 'Critical', time: '2 min ago', status: 'Open' },
  { id: 'AL-205', zone: 'Assembly line', type: 'Unsafe proximity', severity: 'High', time: '11 min ago', status: 'Acknowledged' },
  { id: 'AL-206', zone: 'Loading bay', type: 'Crowding threshold', severity: 'Medium', time: '34 min ago', status: 'Monitoring' },
]

export const cameraCards = [
  { id: 'CAM-101', name: 'Assembly East', zone: 'Assembly line', status: 'Connected', lastProcessed: '3 min ago', detection: 'PPE check active', stream: 'Live feed' },
  { id: 'CAM-102', name: 'Boiler Room', zone: 'Machine operation area', status: 'Processing', lastProcessed: '1 min ago', detection: 'Restricted area alert', stream: 'Live feed' },
  { id: 'CAM-103', name: 'Warehouse Gate', zone: 'Loading and unloading', status: 'Disconnected', lastProcessed: '48 min ago', detection: 'Not connected', stream: 'Upload ready' },
  { id: 'CAM-104', name: 'Tank Yard', zone: 'Chemical storage', status: 'Connected', lastProcessed: '5 min ago', detection: 'Smoke detection watch', stream: 'Live feed' },
]

export const zoneHistory = [
  { name: 'Assembly line', trend: ['12', '16', '14', '22', '21', '25'] },
  { name: 'Machine area', trend: ['10', '12', '18', '20', '19', '24'] },
  { name: 'Chemical storage', trend: ['4', '7', '9', '11', '16', '18'] },
]
