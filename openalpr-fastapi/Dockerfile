FROM python:3.10-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y libopencv-dev wget unzip && \
    apt-get clean

RUN wget `https://github.com/openalpr/openalpr/releases/download/v2.3.0/openalpr-2.3.0-ubuntu-20.04.tar.gz`  -O /tmp/openalpr.tar.gz && \
    tar -xzf /tmp/openalpr.tar.gz -C /usr/local --strip-components=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN chmod +x start.sh

EXPOSE 8000

CMD ["./start.sh"]
