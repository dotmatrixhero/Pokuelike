#ifndef _Menu_hpp_
#define _Menu_hpp_

#include <string>
#include <vector>

#include <libtcod.hpp>

class TCODConsole;

class Menu
{
    public:
    Menu(std::vector<std::string> list);
    ~Menu();

    void draw();
    bool update();
    bool handleInput(TCOD_key_t key);

    private:
    const int getLongest() const;

    private:
    TCODConsole* console;
    std::vector<std::string> items;
    int selection;
};

#endif // _Menu_hpp_
