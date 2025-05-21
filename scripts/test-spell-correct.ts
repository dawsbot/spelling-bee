import { correctSpelling } from "./spell-correct";

(async () => {
  try {
    const input = "Ths is a smple txt with severl speling errrors.";
    const output = await correctSpelling(input);
    console.log("Original:", input);
    console.log("Corrected:", output);
  } catch (err) {
    console.error("Error running spell correct:", err);
    process.exit(1);
  }
})();
