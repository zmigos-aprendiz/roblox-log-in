<div align="center">

# 🎮 Roblox Auto

**Automação de login do Roblox com interface moderna, feedback visual e sonoro.**

![Python](https://img.shields.io/badge/Python-3.9+-3776AB?style=for-the-badge&logo=python&logoColor=white)
![PyQt6](https://img.shields.io/badge/PyQt6-UI-41CD52?style=for-the-badge&logo=qt&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-10%2F11-0078D4?style=for-the-badge&logo=windows&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-6c7cff?style=for-the-badge)

</div>

---

## ✨ Recursos

| | Recurso | Descrição |
|---|---|---|
| 🖥️ | **Interface moderna** | Tema escuro, animações suaves e barra de progresso |
| 🔊 | **Feedback sonoro** | Sons distintos para início, cada etapa, sucesso e erro |
| 🪟 | **Detecção de janela** | Aguarda o Roblox abrir em vez de esperar um tempo fixo |
| 🔒 | **Senha protegida** | Campo mascarado, nunca aparece no log nem no código |
| ⏹️ | **Controle total** | Botão Parar e failsafe pelo mouse |

---

## 🚀 Instalação

```bash
git clone https://github.com/zmigos-aprendiz/roblox-log-in/rbxgui.git
cd roblox-auto
pip install -r requirements.txt
```

## ▶️ Uso

```bash
python roblox_auto.py
```

1. Digite a senha no campo.
2. Clique em **Iniciar**.
3. Não mexa no mouse nem no teclado até terminar.

> 🛑 **Emergência:** mova o mouse para o **canto superior esquerdo** da tela para interromper imediatamente.

---

## ⚙️ Configuração

As coordenadas ficam no bloco `CONFIG` do `roblox_auto.py`:

```python
FOCUS_POS = (756, 380)   # clique para focar a janela
CLICK_A   = (681, 316)   # campo de senha
CLICK_B   = (692, 459)   # botão de login
WINDOW_TIMEOUT = 40      # segundos aguardando a janela
```

Se sua resolução ou a posição da janela for diferente, ajuste esses valores.

---

## 🔄 Como funciona

```
Menu Iniciar → Busca "roblox" → Enter → Aguarda janela
      → Foca janela → Clica no campo → Digita a senha → Clica em login
```

Cada etapa é uma linha na lista `steps`, no formato `(nome, ação, espera)`, fácil de editar.

---

## 🔐 Segurança

- **Nunca** coloque senhas no código ou em arquivos versionados.
- Adicione ao `.gitignore` qualquer arquivo com credenciais (ex.: `.env`).
- Se uma senha já foi commitada, **troque-a**: ela permanece no histórico do Git.

---

## 🧰 Tecnologias

- [PyQt6](https://pypi.org/project/PyQt6/): interface gráfica
- [PyAutoGUI](https://pypi.org/project/PyAutoGUI/): teclado e mouse
- [PyDirectInput](https://pypi.org/project/PyDirectInput/): cliques compatíveis com jogos
- [PyGetWindow](https://pypi.org/project/PyGetWindow/): detecção de janelas

---

## 🤝 Contribuindo

1. Faça um fork ou crie uma branch: `git checkout -b feat/minha-ideia`
2. Commit: `git commit -m "feat: descrição"`
3. Push: `git push -u origin feat/minha-ideia`
4. Abra um **Pull Request**

---

<div align="center">

Feito com ☕ por dois irmãos

</div>
