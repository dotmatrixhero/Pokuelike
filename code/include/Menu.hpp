#ifndef _Menu_hpp_
#define _Menu_hpp_

#include <string>
#include <vector>
#include <memory>

#include <libtcod.hpp>

class Menu
{
    public:
    Menu(std::vector<std::string> itemlist);
    ~Menu();

    // Core Menu methods.
    void draw(int x, int y) const;
    void update();
    void handleInput(TCOD_key_t key);

    private:
    const int getLongest() const;

    private:
    std::unique_ptr<TCODConsole> console;
    std::vector<std::string> items;
    int selectionId;
};

#endif // _Menu_hpp_











































