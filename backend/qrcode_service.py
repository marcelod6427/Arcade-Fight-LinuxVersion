# =============================================================================
# qrcode_service.py — Geração de QR Codes em base64
#
# Usado por main.py em dois pontos:
#   criar_sala()  → QR aponta para /site/login.html?sala=<id>&modo=<modo>
#   placar_qr()   → QR aponta para /site/placar.html
#
# A imagem é gerada em memória (sem arquivo temporário) e retornada como
# string base64 para que o frontend possa renderizá-la diretamente como:
#   <img src="data:image/png;base64,{resultado}">
#
# Dependência: qrcode[pure] (PyPNGImage não requer Pillow — apenas pypng)
# =============================================================================

import io
import base64


def gerar_qr_base64(url: str) -> str:
    """Gera um QR Code PNG a partir de uma URL e retorna como string base64.

    Parâmetros:
        url: URL completa a ser codificada no QR (ex: https://dominio/site/login.html?sala=ABC)

    Retorno:
        String base64 da imagem PNG sem prefixo data URI.
        O frontend adiciona 'data:image/png;base64,' antes de usar no <img>.

    Configuração do QR:
        version=1   → tamanho inicial mínimo; fit=True permite crescer se necessário
        box_size=8  → 8 pixels por módulo (célula do QR)
        border=3    → 3 módulos de margem branca ao redor (mínimo recomendado: 4)
        PyPNGImage  → renderizador puro Python sem dependência de Pillow/PIL
    """
    
    import qrcode
    from qrcode.image.pure import PyPNGImage

    qr = qrcode.QRCode(version=1, box_size=8, border=3)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(image_factory=PyPNGImage)

    # Serializa PNG em buffer de memória para evitar I/O em disco
    buffer = io.BytesIO()
    img.save(buffer)
    return base64.b64encode(buffer.getvalue()).decode()
