#!/bin/bash

# OpenAI document cleanup
sed -i '263a\
        // Clean up document file after processing\
        try {\
          if (attachment.url) {\
            const fileName = attachment.url.split("/").pop();\
            if (fileName) {\
              const docPath = path.join(process.cwd(), "uploads", "documents", fileName);\
              if (fs.existsSync(docPath)) {\
                fs.unlinkSync(docPath);\
                console.log(`Deleted processed document: ${docPath}`);\
              }\
            }\
          }\
        } catch (deleteError) {\
          console.error("Error deleting document file:", deleteError);\
        }' server/routes.ts

# Anthropic document cleanup
sed -i '543a\
        // Clean up document file after processing\
        try {\
          if (attachment.url) {\
            const fileName = attachment.url.split("/").pop();\
            if (fileName) {\
              const docPath = path.join(process.cwd(), "uploads", "documents", fileName);\
              if (fs.existsSync(docPath)) {\
                fs.unlinkSync(docPath);\
                console.log(`Deleted processed document: ${docPath}`);\
              }\
            }\
          }\
        } catch (deleteError) {\
          console.error("Error deleting document file:", deleteError);\
        }' server/routes.ts

# DeepSeek document cleanup
sed -i '784a\
        // Clean up document file after processing\
        try {\
          if (attachment.url) {\
            const fileName = attachment.url.split("/").pop();\
            if (fileName) {\
              const docPath = path.join(process.cwd(), "uploads", "documents", fileName);\
              if (fs.existsSync(docPath)) {\
                fs.unlinkSync(docPath);\
                console.log(`Deleted processed document: ${docPath}`);\
              }\
            }\
          }\
        } catch (deleteError) {\
          console.error("Error deleting document file:", deleteError);\
        }' server/routes.ts

echo "Document cleanup added to all providers"
