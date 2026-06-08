const hid = require('node-hid');
const devices = hid.devices();
const target = devices.filter(d => d.vendorId === 0x2207 && d.productId === 0x0019);
console.log(JSON.stringify(target, null, 2));
