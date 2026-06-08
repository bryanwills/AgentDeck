const { renderDashboardZip, initRenderer } = require('./dist/d200h/image-renderer.js');
const { buildZipPackets, buildBrightnessPacket } = require('./dist/d200h/hid-protocol.js');
const hid = require('node-hid');

async function main() {
  console.log('Initializing renderer...');
  await initRenderer();

  console.log('Finding D200H device...');
  const devices = hid.devices();
  const d200hDevices = devices.filter(d => d.vendorId === 0x2207 && d.productId === 0x0019);
  console.log('Found matching devices:', d200hDevices.length);
  if (d200hDevices.length === 0) {
    console.error('No D200H device found!');
    return;
  }

  const consumer = d200hDevices.find(d => d.usagePage === 12);
  if (!consumer) {
    console.error('Consumer Control interface not found!');
    return;
  }
  console.log('Consumer path:', consumer.path);

  console.log('Opening Consumer Control...');
  const dev = new hid.HID(consumer.path);
  console.log('Consumer Control opened successfully.');

  // Let's set brightness
  console.log('Setting brightness...');
  const brPkt = buildBrightnessPacket(100);
  console.log('Brightness packet:', brPkt.toString('hex').slice(0, 32));
  // Write with 0x00 prepended
  dev.write([0x00, ...Array.from(brPkt)]);
  console.log('Brightness written.');

  console.log('Rendering offline dashboard ZIP...');
  const zip = renderDashboardZip({
    state: 'DISCONNECTED',
    projectName: 'Test Project',
    modelName: 'claude-3-5-sonnet',
    mode: 'default',
    agentType: 'claude-code',
    fiveHourPercent: 10,
    sevenDayPercent: 20,
    totalTokens: 1234,
    totalCost: 0.05,
    options: [],
    currentTool: '',
    allSessions: []
  });
  console.log('ZIP rendered, size:', zip.length);

  const packets = buildZipPackets(zip);
  console.log('Built packets:', packets.length);

  console.log('Writing ZIP packets to device...');
  for (let i = 0; i < packets.length; i++) {
    const pkt = packets[i];
    // Write with 0x00 prepended
    const toWrite = [0x00, ...Array.from(pkt)];
    dev.write(toWrite);
    console.log(`Sent packet ${i + 1}/${packets.length} (${toWrite.length} bytes)`);
    await new Promise(r => setTimeout(r, 8));
  }

  console.log('All packets written. Closing device.');
  dev.close();
}

main().catch(err => {
  console.error('Error in main:', err);
});
