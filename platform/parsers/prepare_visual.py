"""Canonical local raster only, not OCR or AI. Originals remain immutable."""
import sys,io,json,base64,subprocess,tempfile,os,warnings
from PIL import Image,ImageOps
from pypdf import PdfReader
Image.MAX_IMAGE_PIXELS=20000000
warnings.simplefilter('error',Image.DecompressionBombWarning)
def fail(code):
 print(json.dumps({'error':code}));sys.exit(1)
try:
 raw=sys.stdin.buffer.read(20971521)
 if len(raw)>20971520:fail('visual_input_limit')
 mime=sys.argv[1];page=int(sys.argv[2]);pages=1
 if mime=='application/pdf':
  pdf=PdfReader(io.BytesIO(raw))
  if pdf.is_encrypted:fail('visual_encrypted_pdf')
  pages=len(pdf.pages)
  if pages<1 or pages>50 or page<1 or page>pages:fail('visual_page_limit')
  with tempfile.TemporaryDirectory(prefix='dm-visual-') as directory:
   path=os.path.join(directory,'source.pdf');prefix=os.path.join(directory,'page')
   with open(path,'xb') as file:file.write(raw)
   os.chmod(path,0o600)
   subprocess.run([os.environ.get('PDFTOPPM_EXECUTABLE','pdftoppm'),'-f',str(page),'-l',str(page),'-singlefile','-scale-to','2000','-png',path,prefix],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
   image=Image.open(prefix+'.png');image.load()
 elif mime in ['image/png','image/jpeg']:
  if page!=1:fail('visual_page_limit')
  image=Image.open(io.BytesIO(raw))
  if image.format not in ['PNG','JPEG'] or getattr(image,'n_frames',1)!=1:fail('visual_format_unsupported')
  image.load();image=ImageOps.exif_transpose(image)
 else:fail('visual_format_unsupported')
 if image.width*image.height>20000000:fail('visual_pixel_limit')
 image.thumbnail((2000,2000))
 if image.mode in ['RGBA','LA'] or 'transparency' in image.info:
  rgba=image.convert('RGBA');background=Image.new('RGB',rgba.size,'white');background.paste(rgba,mask=rgba.getchannel('A'));image=background
 else:image=image.convert('RGB')
 out=io.BytesIO();image.save(out,format='PNG',optimize=True);data=out.getvalue()
 if len(data)>4194304:fail('visual_output_limit')
 print(json.dumps({'format':'image/png','page':page,'pageCount':pages,'width':image.width,'height':image.height,'base64':base64.b64encode(data).decode(),'preprocessing':'canonical-raster-0.1.0','textExtracted':False}))
except (Image.DecompressionBombError,Image.DecompressionBombWarning):fail('visual_pixel_limit')
except subprocess.TimeoutExpired:fail('visual_render_timeout')
except FileNotFoundError:fail('visual_renderer_unavailable')
except Exception:fail('visual_decode_failed')
