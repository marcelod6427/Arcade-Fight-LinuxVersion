# Usa a versão oficial do Python 3.12 (versão leve)
FROM python:3.12-slim

# Define a pasta de trabalho dentro do contêiner
WORKDIR /app

# Copia apenas o requirements primeiro (para otimizar o cache do Docker)
COPY requirements.txt .

# Instala as dependências do Python
RUN pip install --no-cache-dir -r requirements.txt

# Copia o restante do código do backend para o contêiner
COPY . .

# Expõe a porta que o FastAPI vai rodar
EXPOSE 80

# Comando para iniciar o servidor (assumindo que você usa uvicorn)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "80"]