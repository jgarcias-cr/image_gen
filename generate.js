import { GoogleGenAI, Modality } from "@google/genai";
import * as fs from "node:fs";
import * as path from "node:path";
// Load .env (if present) so we can read SERIAL
import dotenv from 'dotenv';
dotenv.config();

// Read SERIAL from environment; fallback to empty string if missing
const SERIAL = process.env.SERIAL || '';
// If a GEMINI_API_KEY is present in .env, expose it as GOOGLE_API_KEY (some clients/readers expect that)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
if (GEMINI_API_KEY) {
   // Do not print the key value itself for security, only indicate presence
   console.log('GEMINI_API_KEY found in environment — using API key auth for local runs');
   // Some libraries and tools look for GOOGLE_API_KEY; set it to improve compatibility
   process.env.GOOGLE_API_KEY = GEMINI_API_KEY;
}

// Define los prompts (ahora objetos con prompt y filename) y la carpeta de destino
// filename can include a {timestamp} placeholder which will be replaced with Date.now().
const IMAGE_PROMPTS = [
   { prompt: "Una regla para medir", filename: "regla.jpg" },
   // { prompt: "Un borrador para pizarra", filename: "borrador.jpg" },
   // { prompt: "Un marcador para pizarra", filename: "marcador.jpg" },
   // { prompt: "Un maestro de primaria frente a su clase", filename: "maestro.jpg" },
   // { prompt: "Estudiantes sentados en sus pupitres", filename: "estudiantes.jpg" },
   // { prompt: "Una aula", filename: "aula.jpg" },
   // { prompt: "Una pizarra blanca", filename: "pizarra.jpg" },
   // { prompt: "Una persona leyendo un libro", filename: "leer" },
   // { prompt: "Dos personas leyendo un rótulo", filename: "leen" },
   // { prompt: "Varias personas leyendo un anuncio", filename: "leemos.jpg" },
];
const OUTPUT_DIR = path.join(process.cwd(), 'images');
const MODEL_NAME = "gemini-2.5-flash-image"; // Modelo que soporta salida de imágenes

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
      console.log(`\n-- Procesando prompt ${i + 1}/${IMAGE_PROMPTS.length}: "${prompt}"`);

      try {
         // 2. Llama a la API para generar contenido, pidiendo texto e imagen
         const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
               // Es crucial pedir ambas modalidades para obtener la imagen Base64
               responseModalities: [Modality.TEXT, Modality.IMAGE],
            },
         });

         // 3. Extrae la imagen Base64 de la respuesta
         const imagePart = response.candidates[0]?.content.parts.find(
            (part) => part.inlineData?.mimeType.startsWith('image/')
         );

         if (imagePart && imagePart.inlineData) {
            const base64Data = imagePart.inlineData.data;

            // Decode base64 into a buffer
            const imgBuffer = Buffer.from(base64Data, 'base64');

            // Convert to JPEG using sharp to ensure .jpg output regardless of returned mime
            import('sharp').then(sharpModule => {
               const sharp = sharpModule.default;

               sharp(imgBuffer)
                  .jpeg({ quality: 90 })
                  .toBuffer()
                  .then((jpegBuffer) => {
                     // Determine filename. If user provided one, honor it but enforce .jpg and allow {timestamp}.
                     const serialSegment = SERIAL ? `${SERIAL}_` : '';

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
                        // Prepend serial if provided and not already part of the filename
                        if (SERIAL && !fileName.startsWith(`${SERIAL}_`)) {
                           fileName = `${SERIAL}_${fileName}`;
                        }
                     } else {
                        fileName = `image_${i + 1}_${serialSegment}${Date.now()}.jpg`;
                     }

                     const filePath = path.join(OUTPUT_DIR, fileName);

                     fs.writeFileSync(filePath, jpegBuffer);
                     console.log(`✅ Imagen guardada en: ${filePath}`);
                  })
                  .catch((err) => {
                     console.error('❌ Error al convertir la imagen a JPEG:', err.message || err);
                  });
            }).catch(err => {
               console.error('❌ No se pudo cargar sharp para conversión de imagen:', err.message || err);
            });
         } else {
            console.warn(`❌ No se encontró la imagen en la respuesta para el prompt: "${prompt}"`);
         }

      } catch (error) {
         console.error(`❌ Error al generar la imagen para el prompt "${prompt}":`, error.message);
      }
   }
   console.log("\nProceso de generación de imágenes finalizado.");
}

generateAndSaveImages();