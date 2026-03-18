import RPi.GPIO as GPIO
from mfrc522 import SimpleMFRC522
import sys

reader = SimpleMFRC522()

try:
    while True:
        id, text = reader.read_no_block()
        if id:
            print(str(id), flush=True)
except KeyboardInterrupt:
    GPIO.cleanup()
    sys.exit(0)