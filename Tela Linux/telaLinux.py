import tkinter as tk
import threading
import urllib.request
import subprocess
import os

class TelaInicialArcade:
    def __init__(self, root):
        self.root = root
        self.root.attributes('-fullscreen', True)
        self.root.config(cursor="none") # Mantém o mouse invisível
        
        self.bg_color = "#0d0d13"
        self.title_color = "#00f0ff"
        self.text_color = "#cdcdde"
        self.accent_color = "#ff007f"
        
        self.root.configure(bg=self.bg_color)
        
        # O evento <KeyPress> garante que QUALQUER botão da placa USB 
        # (reconhecida como teclado) feche a tela e inicie o jogo.
        self.root.bind("<KeyPress>", self.iniciar_jogo)
        
        self.construir_interface()
        
        # Dispara o ping para o Render assim que a tela abre
        self.acordar_servidor_render()

    def acordar_servidor_render(self):
        def ping_render():
            try:
                # Faz a requisição nativamente, sem precisar instalar a biblioteca requests
                urllib.request.urlopen("https://arcade-fight-ifsp.onrender.com", timeout=30)
            except Exception:
                # Falhas de rede ou timeout na resposta são ignorados silenciosamente
                # O objetivo principal é apenas bater no endpoint para acordar a máquina.
                pass
                
        # Roda em uma thread separada para não congelar as animações da tela inicial
        thread = threading.Thread(target=ping_render)
        thread.daemon = True
        thread.start()

    def construir_interface(self):
        container = tk.Frame(self.root, bg=self.bg_color)
        container.place(relx=0.5, rely=0.5, anchor="center")

        logo = tk.Label(container, text="PROJETO ARCADE", font=("Segoe UI", 48, "bold"), fg=self.title_color, bg=self.bg_color)
        logo.pack(pady=(0, 20))

        linha = tk.Frame(container, bg=self.accent_color, height=3, width=600)
        linha.pack(pady=(0, 40))

        texto_home = (
            "BEM-VINDO AO ARCADE FIGHT\n\n"
            "Prepare-se para uma experiencia nostalgica e eletrizante.\n"
            "Nossa equipe desenvolveu um jogo exclusivo que combina\n"
            "a era de ouro dos arcades com mecanicas modernas e fluidas.\n"
            "Desafie seus reflexos e domine o placar!"
        )
        descricao = tk.Label(container, text=texto_home, font=("Segoe UI", 16), fg=self.text_color, bg=self.bg_color, justify="center")
        descricao.pack(pady=(0, 40))

        texto_equipe = "EQUIPE: Marcelo de Lima | Piero Tubino | Antonio Mariano | Davi Paulino | Joao Victor"
        equipe = tk.Label(container, text=texto_equipe, font=("Segoe UI", 12), fg=self.title_color, bg=self.bg_color)
        equipe.pack(pady=(0, 60))

        self.lbl_start = tk.Label(container, text="PRESSIONE QUALQUER BOTAO PARA INICIAR JOGO", font=("Segoe UI", 18, "bold"), fg=self.accent_color, bg=self.bg_color)
        self.lbl_start.pack()
        self.piscar_texto()

    def piscar_texto(self):
        cor_atual = self.lbl_start.cget("fg")
        nova_cor = self.bg_color if cor_atual == self.accent_color else self.accent_color
        self.lbl_start.config(fg=nova_cor)
        self.root.after(600, self.piscar_texto)

    def iniciar_jogo(self, event):
        self.root.destroy()
        
        # Pega o diretório exato de onde o script python está rodando
        diretorio_atual = os.path.dirname(os.path.abspath(__file__))
        caminho_script = os.path.join(diretorio_atual, "start_game.sh")
        
        # Executa o script bash que você forneceu
        if os.path.exists(caminho_script):
            subprocess.Popen(["bash", caminho_script])
        else:
            print(f"Erro: O arquivo não foi encontrado em {caminho_script}")

if __name__ == "__main__":
    app = tk.Tk()
    app.title("Projeto Arcade - Splash Screen")
    tela = TelaInicialArcade(app)
    app.mainloop()
    