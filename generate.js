import { GoogleGenAI, Modality } from "@google/genai";
import * as fs from "node:fs";
import * as path from "node:path";
import dotenv from 'dotenv';
dotenv.config();

// If a GEMINI_API_KEY is present in .env, expose it as GOOGLE_API_KEY (some clients/readers expect that)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
if (GEMINI_API_KEY) {
   // Some libraries and tools look for GOOGLE_API_KEY; set it to improve compatibility
   process.env.GOOGLE_API_KEY = GEMINI_API_KEY;
}

// Define los prompts (ahora objetos con prompt y filename) y la carpeta de destino
// filename can include a {timestamp} placeholder which will be replaced with Date.now().
const IMAGE_PROMPTS = [
   { prompt: "", filename: "" },
   { prompt: "", filename: "" },
];

const OUTPUT_DIR = path.join(process.cwd(), 'images');
const MODEL_NAME = "gemini-2.5-flash-image"; // Modelo que soporta salida de imágenes
// Enforced style + constraints for every generated image
const ENFORCED_STYLE = 'Retro Comic Book Illustration';
// Spanish constraints: no borders/frames, light solid background, no textures/gradients/text
// Also enforce required output dimensions: width=495px, height=750px
const TARGET_WIDTH = 495;
const TARGET_HEIGHT = 750;
const ENFORCED_CONSTRAINTS = `Sin bordes ni marcos. Fondo de color sólido claro (por ejemplo #F7F7F7). Sin texturas, degradados ni elementos adicionales. Sin texto ni marcas de agua. Tamaño requerido: ${TARGET_WIDTH}px de ancho por ${TARGET_HEIGHT}px de alto.`;
// Background color to use when compositing alpha channels (light solid color)
const LIGHT_BG = '#F7F7F7';

/**
 * Genera imágenes usando la API de Gemini y las guarda localmente.
 */
async function generateAndSaveImages() {
   // 1. Inicializa el cliente Gemini
   const ai = new GoogleGenAI({});

   // Asegúrate de que el directorio de salida exista
   if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
   }

   console.log(`Generando ${IMAGE_PROMPTS.length} imágenes con el modelo ${MODEL_NAME}...`);

   // Style to enforce on every generated image
   const ENFORCED_STYLE = 'Retro Comic Book Illustration';

   for (let i = 0; i < IMAGE_PROMPTS.length; i++) {
      const entry = IMAGE_PROMPTS[i];
      // Support both string and object entries for backward compatibility
      const basePrompt = typeof entry === 'string' ? entry : entry.prompt;
      const requestedFilename = typeof entry === 'string' ? null : entry.filename;
      // Append the enforced style to the prompt so every image uses it
      const prompt = `${basePrompt} -- Estilo: "${ENFORCED_STYLE}"`;
      console.log(`\n-- Procesando prompt ${i + 1}/${IMAGE_PROMPTS.length}: "${entry.prompt}"`);

      try {
         // 2. Llama a la API para generar contenido, pidiendo texto e imagen
         // Append enforced style and constraints to the user prompt so every image follows them
         const fullPrompt = `${prompt}. ${ENFORCED_CONSTRAINTS}`;

         const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
            config: {
               // Es crucial pedir ambas modalidades para obtener la imagen Base64
               responseModalities: [Modality.TEXT, Modality.IMAGE],
            },
         });

         // 3. Extrae la imagen Base64 de la respuesta
         // First, try the expected location
         let imagePart = response.candidates?.[0]?.content?.parts?.find(
            (part) => part.inlineData?.mimeType?.startsWith('image/')
         );

         // If not found, perform a shallow recursive search through the response to locate any
         // object that contains inlineData.mimeType starting with 'image/' (helps with API shape differences)
         if (!imagePart) {
            const findImagePart = (node, depth = 0) => {
               if (!node || depth > 8) return null;
               if (Array.isArray(node)) {
                  for (const item of node) {
                     const res = findImagePart(item, depth + 1);
                     if (res) return res;
                  }
               } else if (typeof node === 'object') {
                  if (node.inlineData && typeof node.inlineData.mimeType === 'string' && node.inlineData.mimeType.startsWith('image/')) {
                     return node;
                  }
                  for (const key of Object.keys(node)) {
                     try {
                        const res = findImagePart(node[key], depth + 1);
                        if (res) return res;
                     } catch (e) {
                        // ignore traversal errors for unexpected structures
                     }
                  }
               }
               return null;
            };

            imagePart = findImagePart(response);
         }

         if (imagePart && imagePart.inlineData) {
            const base64Data = imagePart.inlineData.data;

            // Decode base64 into a buffer
            const imgBuffer = Buffer.from(base64Data, 'base64');

            // Convert to JPEG using sharp to ensure .jpg output regardless of returned mime
            // Flatten any alpha channel onto LIGHT_BG to guarantee a light solid background and no transparency
            import('sharp').then(sharpModule => {
               const sharp = sharpModule.default;

               sharp(imgBuffer)
                  // Ensure final output exactly matches required dimensions.
                  // Use 'contain' so the whole image fits within the target box. This will
                  // letterbox/pillarbox with LIGHT_BG rather than cropping important content.
                  .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'contain', position: 'centre', background: LIGHT_BG })
                  // If there's an alpha channel, flatten it onto the light solid background.
                  .flatten({ background: LIGHT_BG })
                  .jpeg({ quality: 90 })
                  .toBuffer()
                  .then((jpegBuffer) => {
                     // Determine filename. If user provided one, honor it but enforce .jpg and allow {timestamp}.
                     let fileName;
                     if (requestedFilename) {
                        // Replace timestamp placeholder if present
                        fileName = requestedFilename.includes('{timestamp}')
                           ? requestedFilename.replace(/\{timestamp\}/g, `${Date.now()}`)
                           : requestedFilename;
                        // Ensure .jpg extension
                        if (!fileName.toLowerCase().endsWith('.jpg')) {
                           // remove existing extension if any, then add .jpg
                           fileName = fileName.replace(/\.[^.]+$/, '') + '.jpg';
                        }
                     } else {
                        // Default filename: image_<index>_<timestamp>.jpg
                        fileName = `image_${i + 1}_${Date.now()}.jpg`;
                     }

                     const filePath = path.join(OUTPUT_DIR, fileName);

                     fs.writeFileSync(filePath, jpegBuffer);
                     // Use ASCII-friendly indicator to avoid Unicode/emoji display issues in some consoles
                     console.log('[OK] Imagen guardada en:', filePath);
                  })
                  .catch((err) => {
                     console.error('- Error al convertir la imagen a JPEG:', err.message || err);
                  });
            }).catch(err => {
               console.error('- No se pudo cargar sharp para conversión de imagen:', err.message || err);
            });
         } else {
            // Provide more detailed logging to help debug API response structure without dumping base64
            const candidateCount = response.candidates ? response.candidates.length : 0;
            const candidateSummaries = response.candidates?.map((c, idx) => {
               const parts = c?.content?.parts;
               return {
                  candidateIndex: idx,
                  partsCount: parts?.length ?? 0,
                  parts: parts?.map((p) => ({
                     textPreview: typeof p.text === 'string' ? p.text.slice(0, 120) : undefined,
                     mimeType: p.inlineData?.mimeType,
                     dataLength: p.inlineData?.data ? (p.inlineData.data.length || null) : null
                  })) ?? []
               };
            }) ?? [];

            console.warn(`- No se encontró la imagen en la respuesta para el prompt: "${prompt}". candidates=${candidateCount}`);
            console.debug('Response summary (no base64 included):', JSON.stringify({ topKeys: Object.keys(response || {}).slice(0, 20), candidateSummaries }, null, 2));

            // Helpful hint for users: ensure the model supports image modality and that responseModalities included Modality.IMAGE
            console.info('Sugerencia: confirme que el modelo soporta salida de imágenes y que la llamada pidió Modality.IMAGE en responseModalities.');
         }

      } catch (error) {
         console.error(`- Error al generar la imagen para el prompt "${prompt}":`, error.message);
      }
   }
   console.log("\nProceso de generación de imágenes finalizado.");
}

generateAndSaveImages();