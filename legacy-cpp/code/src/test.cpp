#include "../include/ResourceContainer.hpp"

#include <cstdio>

#include <string>
#include <memory>

#include "../include/test.hpp"

class Text
{
    public:
    Text(const std::string& filename)
    {
        text = filename;
    }

    const std::string& get() const
    {
        return text;
    }

    private:
    std::string text;
};

void testResource()
{
    typedef ResourceContainer<Text, std::string> TextContainer;
    TextContainer TextBox;

    TextBox.load("English",  "Hello World!");
    TextBox.load("French",   "Bonjour, Tout Le Monde!");
    TextBox.load("Chinese",  "你好世界");
    TextBox.load("Japanese", "こんにちは世界");

    Text text1 = TextBox.get("English");
    Text text2 = TextBox.get("French");
    Text text3 = TextBox.get("Chinese");
    Text text4 = TextBox.get("Japanese");

    printf("%s\n%s\n%s\n%s\n",
           text1.get().c_str(),
           text2.get().c_str(),
           text3.get().c_str(),
           text4.get().c_str());
}
