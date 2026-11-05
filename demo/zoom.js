// A temporary window zoom makes the whole interface easier to read.
// The highlighted percentage returns this window to the saved default.

function scaleLabel(factor) {
  return `${Math.round(factor * 100)}%`;
}

const defaultScale = 1;
const currentScale = 1.15;

console.log(`Default scale: ${scaleLabel(defaultScale)}`);
console.log(`Current scale: ${scaleLabel(currentScale)}`);
